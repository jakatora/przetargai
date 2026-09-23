import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * LICZNIKI POBIERANIA — bez nich audyt kompletności jest zgadywaniem.
 *
 * Audyt 2026-09-23 nie potrafił odpowiedzieć na pytania: ile ogłoszeń odrzuciła
 * normalizacja, ile scaliła deduplikacja, ile realnie wylądowało w bazie. Pole
 * `skipped` liczyło wyłącznie błędy zapisu (i wynosiło 0), a `fetched` był już
 * po deduplikacji, więc nie dawało się go porównać z liczbą po stronie źródła.
 *
 * Kontrakt: każdy adapter przyjmuje AKUMULATOR `licznik` i raportuje do niego
 * `surowe` (ile rekordów oddało API), `odrzucone` (ile odpadło na normalizacji)
 * i `zapytania` (ile żądań HTTP kosztowało okno). `zduplikowane` wyliczamy na
 * końcu: surowe − odrzucone − unikalne.
 */

process.env.ANTHROPIC_API_KEY = '';

const { pobierzOgloszeniaBzp, SUFIT_ZAPYTANIA } = await import('../src/services/bzp.js');
const { pobierzOgloszeniaTed } = await import('../src/services/ted.js');
const { pustyLicznik, zliczDuplikaty } = await import('../src/lib/licznikZrodla.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const odpowiedz = (dane) => ({
  ok: true, status: 200, statusText: '200',
  json: async () => dane, text: async () => JSON.stringify(dane),
});

const ogloszeniaBzp = (n, prefiks = 'x') =>
  Array.from({ length: n }, (_, i) => ({ bzpNumber: `${prefiks}-${i}`, orderObject: 'Robota', cpvCode: '45000000-7' }));

test('pustyLicznik zaczyna od zer — inaczej pomiar okna nie jest porównywalny', () => {
  assert.deepEqual(pustyLicznik(), { surowe: 0, odrzucone: 0, zapytania: 0 });
});

test('zliczDuplikaty: surowe − odrzucone − unikalne, nigdy poniżej zera', () => {
  assert.equal(zliczDuplikaty({ surowe: 100, odrzucone: 5 }, 60), 35);
  assert.equal(zliczDuplikaty({ surowe: 10, odrzucone: 0 }, 10), 0);
  assert.equal(zliczDuplikaty({ surowe: 0, odrzucone: 0 }, 5), 0, 'atrapy w testach nie mogą dawać ujemnych liczników');
});

test('BZP: ogłoszenie BEZ identyfikatora ląduje w liczniku odrzuconych', async () => {
  globalThis.fetch = async () => odpowiedz([
    ...ogloszeniaBzp(2, 'ok'),
    { orderObject: 'Ogłoszenie bez żadnego identyfikatora' },
  ]);

  const licznik = pustyLicznik();
  const wynik = await pobierzOgloszeniaBzp({ from: '2026-07-17', to: '2026-07-17', licznik });

  assert.equal(wynik.length, 2);
  assert.equal(licznik.surowe, 3, 'API oddało trzy rekordy');
  assert.equal(licznik.odrzucone, 1, 'jeden nie miał identyfikatora — nie da się go zdeduplikować ani zaktualizować');
  assert.equal(licznik.zapytania, 1);
  assert.equal(zliczDuplikaty(licznik, wynik.length), 0);
});

test('BZP: docinanie po województwach liczy NAKŁADKĘ jako duplikaty', async () => {
  // Doba trafia sufit, więc adapter dociąga 16 zapytań wojewódzkich. Każde
  // oddaje te same 500 ogłoszeń co zapytanie bez filtra — czysta nakładka.
  globalThis.fetch = async () => odpowiedz(ogloszeniaBzp(SUFIT_ZAPYTANIA, 'sufit'));

  const licznik = pustyLicznik();
  const wynik = await pobierzOgloszeniaBzp({ from: '2026-07-17', to: '2026-07-17', licznik });

  assert.equal(wynik.length, SUFIT_ZAPYTANIA, 'unikalnych tyle, ile realnie różnych ogłoszeń');
  assert.equal(licznik.zapytania, 17, '1 zapytanie doby + 16 województw');
  assert.equal(licznik.surowe, 17 * SUFIT_ZAPYTANIA);
  assert.equal(zliczDuplikaty(licznik, wynik.length), 16 * SUFIT_ZAPYTANIA,
    'miara kosztu docinania — bez niej nie wiadomo, czy strategia ma sens');
});

test('TED: ogłoszenie bez tytułu ląduje w liczniku odrzuconych', async () => {
  let strona = 0;
  globalThis.fetch = async () => {
    strona += 1;
    const notices = strona === 1
      ? [
        { 'publication-number': '111-2026', 'title-proc': { pol: ['Budowa drogi'] } },
        { 'publication-number': '222-2026' },
      ]
      : [];
    return {
      ok: true, status: 200, statusText: '200',
      json: async () => ({ notices, totalNoticeCount: 2 }),
      text: async () => '',
    };
  };

  const licznik = pustyLicznik();
  const wynik = await pobierzOgloszeniaTed({ lookbackDays: 3, rozmiarStrony: 250, licznik });

  assert.equal(wynik.length, 1);
  assert.equal(licznik.surowe, 2);
  assert.equal(licznik.odrzucone, 1, 'ogłoszenie bez tytułu jest bezużyteczne w feedzie');
  // TED liczy odrzucone do `totalNoticeCount`, więc pętla prosi o kolejną stronę
  // i dopiero pusta odpowiedź ją zamyka. To zachowanie adaptera, nie licznika.
  assert.equal(licznik.zapytania, 2);
});
