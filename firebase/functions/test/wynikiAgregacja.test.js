import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agregujWyniki, dzialCpv, mediana } from '../src/lib/wynikiAgregacja.js';

/*
 * Agregacja wyników postępowań (runda 15) — estymator per (dział CPV, rodzaj,
 * województwo): mediana ceny zwycięzcy (TYLKO części spójne), typowa liczba
 * konkurentów, % wygranych małych firm. Zasilany parserem wynikiParser.js.
 * Wartość dla JDG: „za taką robotę płacono X–Y, startowało ~N firm, w Z% wygrywał mały".
 */

test('dzialCpv: dwucyfrowy dział z pierwszego kodu', () => {
  assert.equal(dzialCpv(['45233000', '45100000']), '45');
  assert.equal(dzialCpv(['90910000']), '90');
  assert.equal(dzialCpv([]), null);
  assert.equal(dzialCpv(null), null);
});

test('mediana: nieparzysta i parzysta', () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([]), null);
});

/** Fabryka wyniku z jedną częścią. */
const wynik = (cpv, woj, rodzaj, czesc) => ({
  cpv: [cpv], wojewodztwo: woj, rodzaj, czesci: [{ liczbaOfert: 3, spojne: true, ...czesc }],
});

test('agreguje ceny TYLKO ze spójnych części; liczba ofert niezależnie od spójności', () => {
  const wyniki = [
    wynik('45233000', 'PL14', 'Works', { cenaWybrana: 100000, liczbaOfert: 4, spojne: true, wygralMaly: true }),
    wynik('45230000', 'PL14', 'Works', { cenaWybrana: 200000, liczbaOfert: 6, spojne: true, wygralMaly: false }),
    // niespójna: cena ODRZUCONA ze statystyki ceny, ale liczba ofert liczona
    wynik('45210000', 'PL14', 'Works', { cenaWybrana: 999999999, liczbaOfert: 2, spojne: false, wygralMaly: true }),
  ];
  const agg = agregujWyniki(wyniki, { minProbka: 1 });
  const b = agg['45|Works|14'];
  assert.ok(b, 'jeden bucket: dział 45, Works, PL14');
  assert.equal(b.cena.mediana, 150000, 'mediana z 100k i 200k — niespójna 999M pominięta');
  assert.equal(b.cena.n, 2, 'tylko 2 spójne ceny');
  assert.equal(b.oferty.mediana, 4, 'liczba ofert z 4,6,2 → mediana 4');
  assert.equal(b.maly.procent, 67, '2 z 3 wygrał mały → 67%');
  assert.equal(b.probka, 3);
});

test('różne (dział, rodzaj, województwo) trafiają do osobnych bucketów', () => {
  const wyniki = [
    wynik('45000000', 'PL14', 'Works', { cenaWybrana: 100000 }),
    wynik('45000000', 'PL24', 'Works', { cenaWybrana: 120000 }),
    wynik('79000000', 'PL14', 'Services', { cenaWybrana: 50000 }),
  ];
  const agg = agregujWyniki(wyniki, { minProbka: 1 });
  assert.deepEqual(Object.keys(agg).sort(), ['45|Works|14', '45|Works|24', '79|Services|14']);
});

test('bucket poniżej minProbka jest pomijany (statystyka niewiarygodna)', () => {
  const wyniki = [wynik('45000000', 'PL14', 'Works', { cenaWybrana: 100000 })];
  assert.deepEqual(agregujWyniki(wyniki, { minProbka: 3 }), {}, '1 próbka < 3 → brak bucketa');
});

test('część bez ceny/województwa/CPV nie wywala agregacji', () => {
  const wyniki = [
    { cpv: [], wojewodztwo: null, rodzaj: null, czesci: [{ liczbaOfert: null, spojne: true }] },
    wynik('45000000', 'PL14', 'Works', { cenaWybrana: 100000 }),
  ];
  const agg = agregujWyniki(wyniki, { minProbka: 1 });
  assert.equal(Object.keys(agg).length, 1, 'tylko poprawny bucket; śmieciowy pominięty');
});
