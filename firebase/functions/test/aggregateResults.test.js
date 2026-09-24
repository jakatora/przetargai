import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { runWynikiAggregation } = await import('../src/jobs/aggregateResults.js');
const { wynikiStats } = await import('../src/db/repos.js');

/*
 * Cykl agregacji wyników (runda 16). Fetcher wstrzykiwany — nie ruszamy sieci.
 * Sprawdzamy: parsowanie surowych ogłoszeń dnia → agregacja → zapis bucketów →
 * odczyt. Odporność: awaria jednego dnia nie wywraca całości.
 */

// Surowe ogłoszenie o wyniku (fragment htmlBody z realnym formatem sekcji V/VI).
const surowe = (id, woj, cena, ofert) => ({
  bzpNumber: id, orderObject: 'Remont drogi', organizationName: 'Gmina',
  cpvCode: '45233000-9 (Roboty)', organizationProvince: woj, orderType: 'Works',
  publicationDate: '2026-07-10',
  procedureResult: 'zawarcieUmowy',
  // `5.1.)` jest OBOWIĄZKOWE: od etapu 6 blok SEKCJI V bez tej etykiety to
  // nagłówek-widmo, a nie część postępowania (reguła zgodna z żywym BZP
  // w 200/200 ogłoszeń — patrz src/lib/wynikiParser.js).
  htmlBody: `SEKCJA V 5.1.) Postępowanie zakończyło się: zawarciem umowy 6.1.) Liczba ofert: ${ofert} 6.4.) Cena oferty: <span class="normal">${cena},00 PLN</span> 8.2.) Wartość umowy: <span class="normal">${cena},00 PLN</span>`,
});

test('agreguje wyniki z wielu dni i zapisuje bucket odczytywalny per klucz', async () => {
  const dane = {
    '2026-07-08': [surowe('A-1', 'PL14', '100000', 4), surowe('A-2', 'PL14', '200000', 6)],
    '2026-07-09': [surowe('A-3', 'PL14', '150000', 5)],
    '2026-07-10': [],
  };
  const wynik = await runWynikiAggregation({
    dni: 3,
    teraz: new Date('2026-07-10T12:00:00Z').getTime(),
    // Wymuszamy ścieżkę REJESTRU: emulator ma wspólną bazę na cały przebieg, więc
    // rozstrzygnięcia zapisane przez inne pliki testowe przełączyłyby job na bazę
    // i ten test mierzyłby coś innego, niż mówi jego nazwa.
    zrodloBazy: async () => null,
    pobierzDzien: async (d) => dane[d] ?? [],
  });

  assert.equal(wynik.ok, true);
  assert.equal(wynik.ogloszen, 3, 'trzy sparsowane ogłoszenia');
  assert.ok(wynik.bucketow >= 1);

  const b = await wynikiStats.pobierz('45|Works|14');
  assert.ok(b, 'bucket dział 45, Works, PL14');
  assert.equal(b.cena.mediana, 150000, 'mediana z 100k/150k/200k');
  assert.equal(b.oferty.mediana, 5, 'mediana ofert 4/5/6');
  assert.equal(b.probka, 3);
});

test('budżet czasu: przerywa pobieranie i AGREGUJE to, co zebrane (nie ginie mid-run)', async () => {
  let wywolan = 0;
  const wynik = await runWynikiAggregation({
    dni: 30,
    teraz: new Date('2026-07-30T12:00:00Z').getTime(),
    zrodloBazy: async () => null,
    budzetMs: -1, // gwarantuje przerwanie na pierwszej iteracji (0 > -1)
    pobierzDzien: async () => {
      wywolan++;
      return [surowe(`X-${wywolan}`, 'PL14', '100000', 4), surowe(`Y-${wywolan}`, 'PL14', '200000', 6),
        surowe(`Z-${wywolan}`, 'PL14', '150000', 5)];
    },
  });
  assert.equal(wynik.ok, true, 'kończy się sukcesem mimo przerwania — nic nie ginie');
  assert.ok(wynik.pominietychDni > 0, 'część dni pominięta przez budżet');
  assert.ok(wywolan <= 2, 'przerwał wcześnie, nie pobrał wszystkich 30 dni');
});

test('awaria jednego dnia nie przerywa agregacji reszty', async () => {
  const wynik = await runWynikiAggregation({
    dni: 2,
    teraz: new Date('2026-07-10T12:00:00Z').getTime(),
    zrodloBazy: async () => null,
    pobierzDzien: async (d) => {
      if (d === '2026-07-09') throw new Error('BZP padło');
      return [surowe('B-1', 'PL24', '90000', 3), surowe('B-2', 'PL24', '90000', 3),
        surowe('B-3', 'PL24', '90000', 3)];
    },
  });
  assert.equal(wynik.bledneDni, 1);
  assert.ok((await wynikiStats.pobierz('45|Works|24')), 'dobry dzień i tak dał bucket');
});

/*
 * Od etapu 6 rozstrzygnięcia leżą w bazie (`wynikiOknoFetch`), więc ponowne
 * ciągnięcie 30 dni z BZP było zdublowaną pracą (~390 s ruchu sieciowego).
 * Job liczy z bazy, gdy jest z czego — a gdy nie ma, wraca do rejestru, żeby
 * `/matches/:id/wyniki` nie zgasło pierwszego dnia po wdrożeniu.
 */
test('liczy z ZAPISANYCH rozstrzygnięć, nie dotykając rejestru', async () => {
  let siegnietoPoRejestr = false;
  const zBazy = [{
    cpv: ['45233000-9'], rodzaj: 'Works', wojewodztwo: '14',
    czesci: [1, 2, 3].map((n) => ({ liczbaOfert: n, cenaWybrana: n * 1000, spojne: true })),
  }];

  const wynik = await runWynikiAggregation({
    dni: 30,
    teraz: new Date('2026-07-10T12:00:00Z').getTime(),
    zrodloBazy: async () => zBazy,
    pobierzDzien: async () => { siegnietoPoRejestr = true; return []; },
  });

  assert.equal(wynik.zrodlo, 'baza');
  assert.equal(siegnietoPoRejestr, false, 'job poszedł po dane do BZP mimo danych w bazie');
  assert.ok(wynik.bucketow >= 1);
});

test('za mało danych w bazie = powrót do rejestru, a nie puste statystyki', async () => {
  let siegnietoPoRejestr = false;
  const wynik = await runWynikiAggregation({
    dni: 2,
    teraz: new Date('2026-07-10T12:00:00Z').getTime(),
    zrodloBazy: async () => null, // próg MIN_ROZSTRZYGNIEC_Z_BAZY niespełniony
    pobierzDzien: async () => {
      siegnietoPoRejestr = true;
      return [surowe('B-1', 'PL14', '100000', 4)];
    },
  });
  assert.equal(wynik.zrodlo, 'rejestr');
  assert.equal(siegnietoPoRejestr, true);
});

test('awaria odczytu bazy NIE gasi statystyk — job wraca do rejestru', async () => {
  const wynik = await runWynikiAggregation({
    dni: 2,
    teraz: new Date('2026-07-10T12:00:00Z').getTime(),
    zrodloBazy: async () => { throw new Error('Firestore niedostępny'); },
    pobierzDzien: async () => [surowe('C-1', 'PL14', '100000', 4)],
  });
  assert.equal(wynik.ok, true);
  assert.equal(wynik.zrodlo, 'rejestr');
});
