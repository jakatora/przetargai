import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zbudujZachete, POCZATEK_TYGODNIA_MS } from '../src/lib/potencjal.js';

/*
 * FOMO na Free + potencjał (wybór usera 2026-07-14). Plan Free pokazuje 5 dopasowań
 * na dobę, reszta czeka na kolejne dni. Pokazujemy REALNĄ liczbę dopasowań i uczciwie
 * zachęcamy do Standard — bez zmyślania kwot (BZP zwykle nie podaje wartości).
 * Czysta logika komunikatu: kiedy pokazać baner i co w nim napisać.
 */

const baza = { isFree: true, dzis: 0, wTymTygodniu: 0, limitDzienny: 5 };

test('plan płatny: nigdy nie pokazujemy zachęty', () => {
  const z = zbudujZachete({ ...baza, isFree: false, dzis: 5, wTymTygodniu: 30 });
  assert.equal(z.pokaz, false);
});

test('Free, osiągnięty dzienny limit: mocny sygnał „reszta jutro”', () => {
  const z = zbudujZachete({ ...baza, dzis: 5, wTymTygodniu: 12 });
  assert.equal(z.pokaz, true);
  assert.equal(z.wariant, 'limit');
  assert.match(z.tytul + z.opis, /Standard/);
  assert.equal(z.w_tym_tygodniu, 12, 'liczba niesiona do UI');
});

test('Free, dużo w tygodniu mimo nieosiągniętego limitu dziś', () => {
  const z = zbudujZachete({ ...baza, dzis: 2, wTymTygodniu: 18 });
  assert.equal(z.pokaz, true);
  assert.equal(z.wariant, 'tydzien');
  assert.match(z.tytul, /18/);
});

test('Free, mało aktywności: NIE naprzykrzamy się (bez fałszywego FOMO)', () => {
  const z = zbudujZachete({ ...baza, dzis: 2, wTymTygodniu: 3 });
  assert.equal(z.pokaz, false);
});

test('limit ma priorytet nad tygodniem, gdy oba spełnione', () => {
  const z = zbudujZachete({ ...baza, dzis: 5, wTymTygodniu: 40 });
  assert.equal(z.wariant, 'limit');
});

test('POCZATEK_TYGODNIA_MS to 7 dni', () => {
  assert.equal(POCZATEK_TYGODNIA_MS, 7 * 24 * 60 * 60 * 1000);
});
