import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

/*
 * 🚨 PAGINACJA BZP (naprawa 2026-07-17) — [[reference_bzp_api_dane]].
 *
 * Zmierzone na żywo: `PageNumber` jest IGNOROWANY (pętla po stronach zwraca w kółko
 * to samo), sufit `PageSize` = 500, a BZP publikuje 400–500 ogłoszeń DZIENNIE.
 * Poprzedni kod robił JEDNO zapytanie `PageSize=500` na całe okno `BZP_LOOKBACK_DAYS`
 * (domyślnie 7 dni ≈ 3000+ ogłoszeń) — czyli po cichu gubił ~85% ogłoszeń.
 *
 * Jedyna poprawna strategia: DZIEŃ PO DNIU; gdy dzień trafi sufit (500), dociąć ten
 * sam dzień po 16 kodach `OrganizationProvince` (jedyny filtr, który BZP honoruje).
 */

const { pobierzOgloszeniaBzp, dniWZakresie, WOJEWODZTWA_TERYT, SUFIT_ZAPYTANIA } =
  await import('../src/services/bzp.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const odpowiedz = (dane) => ({
  ok: true, status: 200, statusText: '200',
  json: async () => dane, text: async () => JSON.stringify(dane),
});

/** n sztucznych ogłoszeń o unikalnych identyfikatorach. */
const ogloszenia = (n, prefiks = 'x') =>
  Array.from({ length: n }, (_, i) => ({ bzpNumber: `${prefiks}-${i}`, orderObject: 'Robota', cpvCode: '45000000-7' }));

/** Podstawia fetch i zbiera URL-e, na które poszły zapytania. */
function podstawFetch(handler) {
  const url = [];
  globalThis.fetch = async (u) => { url.push(String(u)); return handler(new URL(String(u)), url.length); };
  return url;
}

// ---------------- dniWZakresie (czysta logika) ----------------

test('dniWZakresie: dni włącznie, od najstarszego', () => {
  assert.deepEqual(dniWZakresie('2026-07-15', '2026-07-17'),
    ['2026-07-15', '2026-07-16', '2026-07-17']);
});

test('dniWZakresie: jeden dzień = jeden element', () => {
  assert.deepEqual(dniWZakresie('2026-07-17', '2026-07-17'), ['2026-07-17']);
});

test('dniWZakresie: przełom miesiąca liczy się poprawnie', () => {
  assert.deepEqual(dniWZakresie('2026-06-29', '2026-07-01'),
    ['2026-06-29', '2026-06-30', '2026-07-01']);
});

test('WOJEWODZTWA_TERYT: 16 kodów TERYT (nie NUTS), sufit 500', () => {
  assert.equal(WOJEWODZTWA_TERYT.length, 16);
  assert.ok(WOJEWODZTWA_TERYT.includes('PL20'), 'podlaskie — zweryfikowane na żywo');
  assert.ok(WOJEWODZTWA_TERYT.every((w) => /^PL\d{2}$/.test(w)));
  assert.equal(SUFIT_ZAPYTANIA, 500, 'PageSize=1000 → HTTP 400');
});

// ---------------- pętla dzień po dniu ----------------

test('KLUCZOWE: 3-dniowy zakres = 3 zapytania, po jednym na dzień', async () => {
  const url = podstawFetch(() => odpowiedz(ogloszenia(10)));
  await pobierzOgloszeniaBzp({ from: '2026-07-15', to: '2026-07-17' });

  assert.equal(url.length, 3, 'jedno zapytanie na dzień — nie jedno na całe okno');
  const dni = url.map((u) => new URL(u).searchParams.get('PublicationDateFrom'));
  assert.deepEqual(dni, ['2026-07-15T00:00:00', '2026-07-16T00:00:00', '2026-07-17T00:00:00']);
});

test('REGRESJA: daty BEZ sufiksu „Z" (UTC zwraca 0 wyników z BZP)', async () => {
  const url = podstawFetch(() => odpowiedz(ogloszenia(5)));
  await pobierzOgloszeniaBzp({ from: '2026-07-17', to: '2026-07-17' });

  const q = new URL(url[0]).searchParams;
  assert.equal(q.get('PublicationDateFrom'), '2026-07-17T00:00:00');
  assert.equal(q.get('PublicationDateTo'), '2026-07-17T23:59:59');
  assert.doesNotMatch(q.get('PublicationDateFrom'), /Z$/, 'sufiks Z = 0 wyników');
  assert.doesNotMatch(q.get('PublicationDateTo'), /Z$/);
});

test('REGRESJA: NIE paginujemy PageNumber (BZP go ignoruje) i pytamy o sufit', async () => {
  const url = podstawFetch(() => odpowiedz(ogloszenia(10)));
  await pobierzOgloszeniaBzp({ from: '2026-07-17', to: '2026-07-17' });

  const q = new URL(url[0]).searchParams;
  assert.equal(q.get('PageSize'), '500', 'bierzemy maksimum za jednym razem');
  assert.equal(url.length, 1, 'jeden dzień = jedno zapytanie, żadnej pętli po stronach');
});

// ---------------- sufit → docinanie po województwach ----------------

test('KLUCZOWE: dzień na sufity (500) dociskamy 16 zapytaniami po województwach', async () => {
  const url = podstawFetch((u) => {
    const woj = u.searchParams.get('OrganizationProvince');
    // bez filtra: sufit trafiony; z filtrem: mała porcja unikalna dla województwa
    return odpowiedz(woj ? ogloszenia(3, woj) : ogloszenia(SUFIT_ZAPYTANIA, 'sufit'));
  });

  const wynik = await pobierzOgloszeniaBzp({ from: '2026-07-17', to: '2026-07-17' });

  assert.equal(url.length, 1 + 16, '1 próba dnia + 16 województw');
  const uzyte = url.slice(1).map((u) => new URL(u).searchParams.get('OrganizationProvince'));
  assert.deepEqual(uzyte.sort(), [...WOJEWODZTWA_TERYT].sort(), 'wszystkie 16 kodów');
  assert.equal(wynik.length, 48, '16 województw × 3 ogłoszenia — nic nie zgubione');
});

test('dzień PONIŻEJ sufitu nie uruchamia docinania (bez 16 zbędnych zapytań)', async () => {
  const url = podstawFetch(() => odpowiedz(ogloszenia(499)));
  const wynik = await pobierzOgloszeniaBzp({ from: '2026-07-17', to: '2026-07-17' });

  assert.equal(url.length, 1, '499 < 500 → dzień zmieścił się w jednym zapytaniu');
  assert.equal(wynik.length, 499);
});

test('DEDUPLIKACJA: to samo ogłoszenie z dwóch okien liczy się raz', async () => {
  podstawFetch(() => odpowiedz(ogloszenia(5, 'ten-sam')));
  const wynik = await pobierzOgloszeniaBzp({ from: '2026-07-16', to: '2026-07-17' });
  assert.equal(wynik.length, 5, 'dwa dni zwróciły te same 5 — bez duplikatów');
});

test('ODPORNOŚĆ: awaria jednego dnia nie zabiera reszty okna', async () => {
  podstawFetch((u) => {
    if (u.searchParams.get('PublicationDateFrom').startsWith('2026-07-16')) {
      throw new Error('BZP padło na ten dzień');
    }
    return odpowiedz(ogloszenia(4, 'ok'));
  });

  const wynik = await pobierzOgloszeniaBzp({ from: '2026-07-15', to: '2026-07-17' });
  assert.equal(wynik.length, 4, 'dni 15 i 17 zwróciły te same 4 — dzień 16 pominięty, nie wywrócił całości');
});
