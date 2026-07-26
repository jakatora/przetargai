import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Adapter Bazy Konkurencyjności + ścieżka scalania — podzadanie 3/7 ulepszenia
 * „Radar zamówień podprogowych (poniżej 170 tys. zł)".
 *
 * Zakres testu:
 *   • KONTRAKT adaptera (`utworzAdapter`) — wspólny interfejs `pobierz(branza, region) -> surowe[]`.
 *   • MAPOWANIE odpowiedzi publicznego API BK na surowe ogłoszenie i dalej na
 *     ZNORMALIZOWANY rekord (`mapujSzczegol` + `normalizujPodprogowe`): tytuł bez
 *     tagów <mark>, sumowanie `estimated_value` (format PL) z wielu zamówień,
 *     województwo z `fulfillment_places`, zamawiający z `advertiser_address_details`,
 *     termin/publikacja do ISO, link publiczny. Wartości dobrane tak, by pokryć
 *     progi: 37k (<80k BK → poza), 84k i 93,5k (80k–170k → w radarze), 221k i 304k
 *     (≥170k → nadprogowe).
 *   • MAPOWANIE wpisu z listy wyszukiwarki (`mapujListe`) — zdejmowanie <mark> z
 *     `title[]`/`content`, województwo z „miejscowość, województwo".
 *   • ŚCIEŻKA adapter → normalizacja → upsert do `zamowienia_podprogowe` z dedupem
 *     po `hash_dedup` (`zbierzIWepnij` + `createPodprogoweRepo` na bazie w pamięci
 *     z migracji 009): nowe dodane, duplikaty pominięte, nadprogowe odrzucone.
 *
 * Fixture'y są WIERNE względem żywego API (zweryfikowane 2026-07-27):
 *   GET /api/announcements/search?query=...&status[0]=PUBLISHED
 *       -> { status, data: { advertisements: [...], meta: { total } } }
 *   GET /api/announcements/{id}
 *       -> { status, data: { advertisement: { ..., orders:[{ estimated_value, order_items:[...] }] } } }
 */

const bk = await import('../src/services/adaptery/bazaKonkurencyjnosci.js');
const { wyodrebnijListe, mapujSzczegol, mapujListe, pobierz, adapter } = bk;
const { utworzAdapter } = await import('../src/services/adaptery/kontrakt.js');
const { zbierzIWepnij } = await import('../src/services/adaptery/scalPodprogowe.js');
const { createPodprogoweRepo } = await import('../src/db/podprogoweRepo.js');
const { normalizujPodprogowe } = await import('../src/lib/normalizacjaPodprogowe.js');

// ── Fixture: odpowiedź wyszukiwarki (search) ─────────────────────────────────
const BK_SEARCH = {
  status: 'Ok',
  data: {
    advertisements: [
      {
        id: 285687,
        title: ['<mark>Roboty</mark> <mark>budowlane</mark> polegające na budowie wiaty przystankowo – rekreacyjnej przy ścieżce rowerowej Nakielno - Strączno'],
        content: 'Przedmiotem zamówienia są <mark>roboty</mark> <mark>budowlane</mark> polegające na budowie wiaty.',
        advertiser_name: 'Powiatowy Zarząd Dróg',
        is_mine: false,
        publication_date: '2026-07-21',
        submission_deadline: '2026-08-05 12:00:00',
        fulfillment_place: 'Strączno, zachodniopomorskie',
        favorite: null,
      },
      {
        id: 377136,
        title: ['<mark>Dostawa</mark> sprzętu komputerowego'],
        content: 'Przedmiotem zamówienia jest <mark>dostawa</mark> laptopów.',
        advertiser_name: 'Stowarzyszenie Dobra Edukacja',
        is_mine: false,
        publication_date: '2026-07-20',
        submission_deadline: '2026-08-01 10:00:00',
        fulfillment_place: 'Warszawa, mazowieckie',
        favorite: null,
      },
    ],
    meta: { total: 269 },
  },
};

// Buduje wierny fixture szczegółu ogłoszenia (data.advertisement) BK.
function bkDetail({
  id,
  tytul,
  wartosci,                    // tablica estimated_value (string PL lub null)
  kategoria = 'Roboty budowlane',
  wojewodztwo = 'mazowieckie',
  zamawiajacy = 'Stowarzyszenie Dobra Edukacja',
  termin = '2026-08-05 12:00:00',
  publikacja = '2026-07-21',
  opis = 'Przedmiotem zamówienia jest realizacja zadania zgodnie z zapytaniem ofertowym.',
} = {}) {
  return {
    status: 'Ok',
    data: {
      advertisement: {
        id,
        title: tytul,
        publication_date: publikacja,
        submission_deadline: termin,
        advertiser_address_details: {
          name: zamawiajacy,
          identification_number_type: 'nip',
          identification_number: '5272683613',
          address: { country: 'Polska', voivodeship: wojewodztwo, poviat: 'Warszawa', locality: 'Warszawa', street: 'Górczewska' },
        },
        orders: wartosci.map((v, i) => ({
          id: 610900 + i,
          estimated_value: v,
          order_items: [
            {
              id: 686800 + i,
              description: opis,
              cpv_items: [{ id: 6409, code: '45211320-8', name: 'Roboty budowlane w zakresie altan' }],
              fulfillment_places: [{ country: 'Polska', voivodeship: wojewodztwo, poviat: 'wałecki', commune: 'Wałcz', locality: 'Strączno' }],
              category: { id: 2, name: kategoria },
              subcategory: { id: 9, name: kategoria },
            },
          ],
          evaluation_criteria: [{ id: 1, price_criterion: true, description: 'Cena - waga 100%' }],
        })),
        attachments: [],
      },
    },
  };
}

const DETALE = {
  285687: bkDetail({ id: 285687, tytul: 'Roboty budowlane polegające na budowie wiaty przystankowo – rekreacyjnej Nakielno - Strączno', wartosci: [null], kategoria: 'Roboty budowlane', wojewodztwo: 'zachodniopomorskie', zamawiajacy: 'Powiatowy Zarząd Dróg' }),
  377136: bkDetail({ id: 377136, tytul: 'Dostawa sprzętu komputerowego', wartosci: ['84000,00'], kategoria: 'Dostawy', wojewodztwo: 'mazowieckie', termin: '2026-08-01 10:00:00' }),
  377711: bkDetail({ id: 377711, tytul: 'Dostawa artykułów biurowych', wartosci: ['37000,00'], kategoria: 'Dostawy' }),
  377111: bkDetail({ id: 377111, tytul: 'Budowa placu zabaw', wartosci: ['221400,00'], kategoria: 'Roboty budowlane' }),
  378692: bkDetail({ id: 378692, tytul: 'Dostawa i montaż wyposażenia', wartosci: ['92228,84', '1284,12'], kategoria: 'Dostawy' }),
  377513: bkDetail({ id: 377513, tytul: 'Kompleksowa modernizacja', wartosci: ['198901,14', '105472,50'], kategoria: 'Roboty budowlane' }),
};

// ── Kontrakt adaptera ────────────────────────────────────────────────────────

test('kontrakt: utworzAdapter tworzy zamrożony obiekt { zrodlo, pobierz }', () => {
  const a = utworzAdapter({ zrodlo: 'baza_konkurencyjnosci', pobierz: async () => [] });
  assert.equal(a.zrodlo, 'baza_konkurencyjnosci');
  assert.equal(typeof a.pobierz, 'function');
  assert.throws(() => { a.zrodlo = 'x'; }, 'adapter jest zamrożony (kontrakt niezmienny)');
});

test('kontrakt: utworzAdapter odrzuca niepoprawny kształt', () => {
  assert.throws(() => utworzAdapter({ zrodlo: '', pobierz: async () => [] }), /zrodlo/);
  assert.throws(() => utworzAdapter({ zrodlo: 'bk', pobierz: 123 }), /pobierz/);
});

test('kontrakt: domyślny adapter BK spełnia interfejs (zrodlo + pobierz)', () => {
  assert.equal(adapter.zrodlo, 'baza_konkurencyjnosci');
  assert.equal(typeof adapter.pobierz, 'function');
});

// ── wyodrebnijListe: defensywne wyciąganie listy ─────────────────────────────

test('wyodrebnijListe: wyciąga data.advertisements z odpowiedzi search', () => {
  const lista = wyodrebnijListe(BK_SEARCH);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].id, 285687);
});

test('wyodrebnijListe: nietypowy/pusty kształt → pusta tablica (bez wyjątku)', () => {
  assert.deepEqual(wyodrebnijListe(null), []);
  assert.deepEqual(wyodrebnijListe({}), []);
  assert.deepEqual(wyodrebnijListe({ data: {} }), []);
  assert.deepEqual(wyodrebnijListe({ data: { advertisements: 'nie-tablica' } }), []);
});

// ── mapujSzczegol: szczegół BK → surowe ──────────────────────────────────────

test('mapujSzczegol: mapuje pola szczegółu BK na surowe ogłoszenie', () => {
  const s = mapujSzczegol(DETALE[377136]);
  assert.equal(s.zrodlo, 'baza_konkurencyjnosci');
  assert.equal(s.id_zewnetrzny, '377136');
  assert.equal(s.tytul, 'Dostawa sprzętu komputerowego');
  assert.equal(s.zamawiajacy, 'Stowarzyszenie Dobra Edukacja');
  assert.equal(s.wartosc_netto, 84000);
  assert.equal(s.waluta, 'PLN');
  assert.equal(s.termin_skladania, '2026-08-01T10:00:00');
  assert.equal(s.data_publikacji, '2026-07-21');
  assert.equal(s.region, 'mazowieckie');
  assert.equal(s.branza, 'Dostawy');
  assert.equal(s.link, 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/ogloszenia/377136');
});

test('mapujSzczegol: sumuje estimated_value (format PL) z wielu zamówień', () => {
  const s = mapujSzczegol(DETALE[378692]);
  assert.equal(s.wartosc_netto, 93512.96, '92228,84 + 1284,12 = 93512,96');
});

test('mapujSzczegol: brak wartości (estimated_value null) → wartosc_netto null', () => {
  const s = mapujSzczegol(DETALE[285687]);
  assert.equal(s.wartosc_netto, null);
  assert.equal(s.region, 'zachodniopomorskie');
});

test('mapujSzczegol: akceptuje też sam obiekt advertisement (bez koperty data)', () => {
  const s = mapujSzczegol(DETALE[377136].data.advertisement);
  assert.equal(s.id_zewnetrzny, '377136');
  assert.equal(s.wartosc_netto, 84000);
});

// ── Mapowanie BK → ZNORMALIZOWANY rekord (rdzeń podzadania) ───────────────────

test('BK→rekord: 84 000 zł (80k–170k) kwalifikuje się jako podprogowe', () => {
  const { rekord, kwalifikujeSie } = normalizujPodprogowe(mapujSzczegol(DETALE[377136]), {});
  assert.equal(kwalifikujeSie, true);
  assert.equal(rekord.zrodlo, 'baza_konkurencyjnosci');
  assert.equal(rekord.wartosc_netto, 84000);
  assert.equal(typeof rekord.hash_dedup, 'string');
  assert.ok(rekord.hash_dedup.length > 0);
});

test('BK→rekord: suma 93 512,96 zł kwalifikuje się', () => {
  const { kwalifikujeSie } = normalizujPodprogowe(mapujSzczegol(DETALE[378692]), {});
  assert.equal(kwalifikujeSie, true);
});

test('BK→rekord: 37 000 zł (<80k) NIE kwalifikuje się (poniżej zasady konkurencyjności)', () => {
  const { kwalifikujeSie, powod } = normalizujPodprogowe(mapujSzczegol(DETALE[377711]), {});
  assert.equal(kwalifikujeSie, false);
  assert.match(powod, /konkurencyjno|80\s?000/i);
});

test('BK→rekord: 221 400 zł (≥170k) NIE kwalifikuje się (nadprogowe)', () => {
  const { kwalifikujeSie } = normalizujPodprogowe(mapujSzczegol(DETALE[377111]), {});
  assert.equal(kwalifikujeSie, false);
});

test('BK→rekord: suma 304 373,64 zł (≥170k) NIE kwalifikuje się', () => {
  const { kwalifikujeSie } = normalizujPodprogowe(mapujSzczegol(DETALE[377513]), {});
  assert.equal(kwalifikujeSie, false);
});

// ── mapujListe: wpis z wyszukiwarki → surowe (fallback bez szczegółu) ─────────

test('mapujListe: zdejmuje <mark> z title[]/content i wyciąga województwo', () => {
  const s = mapujListe(BK_SEARCH.data.advertisements[0]);
  assert.equal(s.zrodlo, 'baza_konkurencyjnosci');
  assert.equal(s.id_zewnetrzny, '285687');
  assert.ok(!/<mark>|<\/mark>/.test(s.tytul), 'tytuł bez tagów <mark>');
  assert.match(s.tytul, /^Roboty budowlane/);
  assert.equal(s.zamawiajacy, 'Powiatowy Zarząd Dróg');
  assert.equal(s.region, 'zachodniopomorskie');
  assert.equal(s.termin_skladania, '2026-08-05T12:00:00');
  assert.equal(s.wartosc_netto, null, 'lista wyszukiwarki nie zawiera wartości');
});

// ── pobierz(): search → szczegół → surowe[] (adapter z wstrzykniętym fetch) ───

test('pobierz: łączy listę z wyszukiwarki ze szczegółami w surowe[]', async () => {
  const wywolania = { lista: 0, szczegol: [] };
  const surowe = await pobierz('roboty budowlane', '', {
    pobierzListe: async (fraza) => { wywolania.lista++; assert.equal(fraza, 'roboty budowlane'); return BK_SEARCH; },
    pobierzSzczegol: async (id) => { wywolania.szczegol.push(id); return DETALE[id]; },
  });
  assert.equal(wywolania.lista, 1);
  assert.deepEqual(wywolania.szczegol, [285687, 377136]);
  assert.equal(surowe.length, 2);
  assert.equal(surowe[1].wartosc_netto, 84000);
});

test('pobierz: gdy szczegół niedostępny → fallback na mapowanie z listy (bez rzucania)', async () => {
  const surowe = await pobierz('dostawa', '', {
    pobierzListe: async () => BK_SEARCH,
    pobierzSzczegol: async (id) => { if (id === 285687) throw new Error('503'); return DETALE[id]; },
  });
  assert.equal(surowe.length, 2);
  assert.equal(surowe[0].id_zewnetrzny, '285687');   // z listy (fallback)
  assert.equal(surowe[0].wartosc_netto, null);
  assert.equal(surowe[1].wartosc_netto, 84000);      // ze szczegółu
});

test('pobierz: pusta branża i region → nie zmyśla zapytania, zwraca []', async () => {
  let dotkniete = false;
  const surowe = await pobierz('', '', { pobierzListe: async () => { dotkniete = true; return BK_SEARCH; } });
  assert.equal(surowe.length, 0);
  assert.equal(dotkniete, false);
});

// ── Ścieżka: adapter → normalizacja → upsert z dedupem po hash_dedup ──────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_009 = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/009_radar_podprogowy.sql'),
  'utf8',
);

function bazaZTabela() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = OFF;'); // FK do users nieistotny dla tego testu
  d.exec(MIG_009);
  return d;
}

test('ścieżka: upsert kwalifikujących się, dedup po hash_dedup, odrzucenie nadprogowych', async () => {
  const d = bazaZTabela();
  const repo = createPodprogoweRepo(d);

  // Fake adapter zwraca: 84k (dodać), duplikat 84k (ten sam id → dedup), 221k (nadprogowe → odrzucić).
  const fakeAdapter = utworzAdapter({
    zrodlo: 'baza_konkurencyjnosci',
    pobierz: async () => [
      mapujSzczegol(DETALE[377136]),        // 84 000 → kwalifikuje się
      mapujSzczegol(DETALE[377136]),        // ten sam → duplikat (hash_dedup)
      mapujSzczegol(DETALE[377111]),        // 221 400 → nadprogowe (odrzucone)
    ],
  });

  const p = await zbierzIWepnij({ adapter: fakeAdapter, repo });
  assert.equal(p.pobrano, 3);
  assert.equal(p.zakwalifikowano, 2);   // dwa razy 84k
  assert.equal(p.dodano, 1);            // drugi to duplikat
  assert.equal(p.duplikaty, 1);
  assert.equal(p.odrzucono, 1);         // 221k
  assert.equal(repo.count(), 1);

  // Ponowne uruchomienie (kolejny cykl monitora) niczego nie dubluje.
  const p2 = await zbierzIWepnij({ adapter: fakeAdapter, repo });
  assert.equal(p2.dodano, 0);
  assert.equal(p2.duplikaty, 2);
  assert.equal(repo.count(), 1);

  d.close();
});

test('ścieżka: zapisany rekord ma poprawne flagi/latwiejszy_start i wartość', async () => {
  const d = bazaZTabela();
  const repo = createPodprogoweRepo(d);
  const surowe = mapujSzczegol(DETALE[377136]);
  const { rekord } = normalizujPodprogowe(surowe, {});
  const { rekord: zapisany, created } = repo.upsert(rekord);
  assert.equal(created, true);
  assert.equal(zapisany.wartosc_netto, 84000);
  assert.equal(zapisany.zrodlo, 'baza_konkurencyjnosci');
  assert.equal(typeof zapisany.latwiejszy_start, 'boolean');
  assert.equal(typeof zapisany.flagi, 'object');
  assert.equal(zapisany.hash_dedup, rekord.hash_dedup);
  d.close();
});

test('ścieżka: konfiguracja preferencji (branża/region) filtruje niedopasowane', async () => {
  const d = bazaZTabela();
  const repo = createPodprogoweRepo(d);
  const fakeAdapter = utworzAdapter({
    zrodlo: 'baza_konkurencyjnosci',
    pobierz: async () => [mapujSzczegol(DETALE[377136])], // branża „Dostawy", region mazowieckie
  });
  // Preferencja na „roboty budowlane" nie pasuje do „Dostawa sprzętu komputerowego".
  const p = await zbierzIWepnij({ adapter: fakeAdapter, repo, branza: 'roboty budowlane', region: '' });
  assert.equal(p.zakwalifikowano, 0);
  assert.equal(p.odrzucono, 1);
  assert.equal(repo.count(), 0);
  d.close();
});
