import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Adapter TED (Tenders Electronic Daily) — polskie postępowania POWYŻEJ progów UE,
 * których NIE MA w BZP. API zweryfikowane na żywo 2026-07-10:
 *   POST https://api.ted.europa.eu/v3/notices/search — bez klucza, bez logowania.
 *
 * Kontrakt odpowiedzi (z żywej sondy):
 *  • title-proc / buyer-name — obiekty wielojęzyczne {pol: ..., eng: ...},
 *  • classification-cpv — tablica kodów Z DUPLIKATAMI,
 *  • deadline-receipt-tender-date-lot — tablica per CZĘŚĆ zamówienia,
 *    w dziwnym formacie „2026-09-08+02:00" (data z offsetem, bez godziny),
 *  • links.html.POL — ludzki URL ogłoszenia.
 */

process.env.ANTHROPIC_API_KEY = '';

const { mapujOgloszenieTed, pobierzOgloszeniaTed } = await import('../src/services/ted.js');

// ---------------- mapowanie pojedynczego ogłoszenia ----------------

const NOTICE = {
  'publication-number': '468242-2026',
  'title-proc': { pol: 'Odbieranie odpadów komunalnych w Gminie Wilamowice.' },
  'buyer-name': { pol: ['Gmina Wilamowice'] },
  'classification-cpv': ['90513100', '90512000', '90513100'],
  'publication-date': '2026-07-08+02:00',
  'deadline-receipt-tender-date-lot': ['2026-09-10+02:00', '2026-09-08+02:00'],
  links: { html: { POL: 'https://ted.europa.eu/pl/notice/-/detail/468242-2026' } },
};

test('mapowanie: identyfikator z prefiksem ted: (kolizje z numeracją BZP niemożliwe)', () => {
  assert.equal(mapujOgloszenieTed(NOTICE).externalId, 'ted:468242-2026');
});

test('mapowanie: tytuł i zamawiający po polsku, source=ted', () => {
  const t = mapujOgloszenieTed(NOTICE);
  assert.equal(t.title, 'Odbieranie odpadów komunalnych w Gminie Wilamowice.');
  assert.equal(t.organization, 'Gmina Wilamowice');
  assert.equal(t.source, 'ted');
});

test('mapowanie: CPV bez duplikatów, sklejone przecinkami (format zgodny z BZP)', () => {
  assert.equal(mapujOgloszenieTed(NOTICE).cpvMain, '90513100, 90512000');
});

test('mapowanie: termin = NAJWCZEŚNIEJSZA część, koniec dnia czasu polskiego w UTC', () => {
  const t = mapujOgloszenieTed(NOTICE);
  // „2026-09-08+02:00" (data bez godziny) = do końca 8 września czasu polskiego.
  // Wrzesień = czas letni (UTC+2): koniec dnia 23:59:59.999+02:00 → 21:59:59.999Z.
  assert.equal(t.deadline, '2026-09-08T21:59:59.999Z');
});

test('mapowanie: pełny znacznik czasu z godziną przechodzi bez zgadywania', () => {
  const t = mapujOgloszenieTed({
    ...NOTICE,
    'deadline-receipt-tender-date-lot': ['2026-09-08T10:00:00+02:00'],
  });
  assert.equal(t.deadline, '2026-09-08T08:00:00.000Z');
});

test('mapowanie: fallback języka — bez polskiej wersji bierzemy pierwszą dostępną', () => {
  const t = mapujOgloszenieTed({
    ...NOTICE,
    'title-proc': { eng: 'Municipal waste collection' },
    'buyer-name': { eng: ['Municipality X'] },
  });
  assert.equal(t.title, 'Municipal waste collection');
  assert.equal(t.organization, 'Municipality X');
});

test('mapowanie: ogłoszenie bez tytułu odpada (null) — nie zaśmiecamy feedu', () => {
  assert.equal(mapujOgloszenieTed({ ...NOTICE, 'title-proc': undefined }), null);
  assert.equal(mapujOgloszenieTed({ ...NOTICE, 'publication-number': undefined }), null);
});

test('mapowanie: URL polski, z fallbackiem na dowolny język', () => {
  assert.equal(mapujOgloszenieTed(NOTICE).url, 'https://ted.europa.eu/pl/notice/-/detail/468242-2026');
  const bezPol = mapujOgloszenieTed({
    ...NOTICE,
    links: { html: { ENG: 'https://ted.europa.eu/en/notice/-/detail/468242-2026' } },
  });
  assert.equal(bezPol.url, 'https://ted.europa.eu/en/notice/-/detail/468242-2026');
});

test('mapowanie: brak terminów części → deadline null (przetarg bez terminu jest legalny)', () => {
  assert.equal(mapujOgloszenieTed({ ...NOTICE, 'deadline-receipt-tender-date-lot': undefined }).deadline, null);
});

// ---------------- pobieranie z paginacją ----------------

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

function stronaTed(numery, total) {
  return {
    ok: true,
    json: async () => ({
      notices: numery.map((n) => ({
        'publication-number': n,
        'title-proc': { pol: `Przetarg ${n}` },
        'buyer-name': { pol: ['Gmina'] },
        links: { html: { POL: `https://ted.europa.eu/pl/notice/-/detail/${n}` } },
      })),
      totalNoticeCount: total,
    }),
  };
}

test('pobieranie: dokłada strony aż zbierze totalNoticeCount', async () => {
  const zapytania = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    zapytania.push(body);
    return body.page === 1 ? stronaTed(['1-2026', '2-2026'], 3) : stronaTed(['3-2026'], 3);
  };

  const ogloszenia = await pobierzOgloszeniaTed({ lookbackDays: 3, rozmiarStrony: 2 });
  assert.equal(ogloszenia.length, 3);
  assert.equal(zapytania.length, 2, 'dwie strony po 2 przy total=3');
  assert.equal(zapytania[0].page, 1);
  assert.equal(zapytania[1].page, 2);
  assert.match(zapytania[0].query, /place-of-performance IN \(POL\)/);
  assert.match(zapytania[0].query, /form-type = competition/);
  assert.match(zapytania[0].query, /publication-date >= \d{8}/);
});

test('pobieranie: zapytanie sortuje malejąco po dacie publikacji (najnowsze na 1. stronie)', async () => {
  // Regresja 2026-07-28: bez SORT BY najnowsze ogłoszenia TED wypadały poza sufit
  // stron i nie trafiały do feedu przez dni. Malejące sortowanie to naprawia.
  let zapytanie;
  globalThis.fetch = async (url, opts) => { zapytanie = JSON.parse(opts.body).query; return stronaTed(['1-2026'], 1); };

  await pobierzOgloszeniaTed({ lookbackDays: 3 });
  assert.match(zapytanie, /SORT BY publication-date DESC\s*$/, 'sufiks SORT BY DESC jest wymagany');
});

test('pobieranie: twardy sufit stron chroni przed niespodziewanym zalewem', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; return stronaTed(['x-2026'], 999999); };

  await pobierzOgloszeniaTed({ lookbackDays: 3, rozmiarStrony: 1, maksStron: 4 });
  assert.equal(wywolania, 4, 'sufit stron MUSI zatrzymać pętlę');
});

test('pobieranie: HTTP 500 rzuca czytelnym błędem (izoluje go rejestr źródeł w jobie)', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'awaria TED' });
  await assert.rejects(() => pobierzOgloszeniaTed({ lookbackDays: 3 }), /TED/);
});
