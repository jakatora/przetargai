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
  htmlBody: `SEKCJA V 6.1.) Liczba ofert: ${ofert} 6.4.) Cena oferty: <span class="normal">${cena},00 PLN</span> 8.2.) Wartość umowy: <span class="normal">${cena},00 PLN</span>`,
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

test('awaria jednego dnia nie przerywa agregacji reszty', async () => {
  const wynik = await runWynikiAggregation({
    dni: 2,
    teraz: new Date('2026-07-10T12:00:00Z').getTime(),
    pobierzDzien: async (d) => {
      if (d === '2026-07-09') throw new Error('BZP padło');
      return [surowe('B-1', 'PL24', '90000', 3), surowe('B-2', 'PL24', '90000', 3),
        surowe('B-3', 'PL24', '90000', 3)];
    },
  });
  assert.equal(wynik.bledneDni, 1);
  assert.ok((await wynikiStats.pobierz('45|Works|24')), 'dobry dzień i tak dał bucket');
});
