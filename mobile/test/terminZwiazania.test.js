import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analizaZwiazania, MAKS_TERMINY } from '../src/lib/terminZwiazania.js';

const TERAZ = Date.UTC(2026, 0, 15); // 15 stycznia 2026

test('analizaZwiazania: spory zapas + wadium pokrywa → neutralny', () => {
  const w = analizaZwiazania({ terminZwiazania: '2026-02-15', wadiumWazneDo: '2026-02-20' }, TERAZ);
  assert.equal(w.znany, true);
  assert.equal(w.dniDoKonca, 31);
  assert.equal(w.wadiumPokrywa, true);
  assert.equal(w.ton, 'neutral');
});

test('analizaZwiazania: wadium wygasa przed końcem terminu → danger', () => {
  const w = analizaZwiazania({ terminZwiazania: '2026-01-20', wadiumWazneDo: '2026-01-18' }, TERAZ);
  assert.equal(w.wadiumPokrywa, false);
  assert.equal(w.ton, 'danger');
  assert.match(w.komunikat, /wadium/i);
});

test('analizaZwiazania: końcówka terminu (≤7 dni) → ostrzeżenie o przedłużeniu', () => {
  const w = analizaZwiazania({ terminZwiazania: '2026-01-18', wadiumWazneDo: '2026-02-01' }, TERAZ);
  assert.equal(w.dniDoKonca, 3);
  assert.equal(w.ton, 'ostrzezenie');
  assert.match(w.komunikat, /przedłuż/i);
});

test('analizaZwiazania: po terminie → danger (art. 226 ust. 1 pkt 4)', () => {
  const w = analizaZwiazania({ terminZwiazania: '2026-01-10' }, TERAZ);
  assert.equal(w.poTerminie, true);
  assert.equal(w.ton, 'danger');
  assert.match(w.etykieta, /Po terminie/i);
});

// Poprawka 2026-09-25: „dziś" to dzień kalendarzowy w POLSCE, nie w UTC.
test('analizaZwiazania: po północy czasu polskiego termin z wczoraj już upłynął', () => {
  // 00:30 CET 16.01 = 23:30 UTC 15.01 — wg UTC byłoby jeszcze „Termin upływa dziś".
  const w = analizaZwiazania({ terminZwiazania: '2026-01-15' }, Date.UTC(2026, 0, 15, 23, 30));
  assert.equal(w.poTerminie, true);
  assert.equal(w.dniDoKonca, -1);
  assert.equal(w.ton, 'danger');
});

test('analizaZwiazania: późny wieczór PL w dniu terminu → „Termin upływa dziś"', () => {
  // 23:30 CEST 10.06 = 21:30 UTC 10.06
  const w = analizaZwiazania({ terminZwiazania: '2026-06-10' }, Date.UTC(2026, 5, 10, 21, 30));
  assert.equal(w.poTerminie, false);
  assert.equal(w.dniDoKonca, 0);
  assert.equal(w.etykieta, 'Termin upływa dziś');
});

test('analizaZwiazania: brak terminu → nieznany', () => {
  const w = analizaZwiazania({}, TERAZ);
  assert.equal(w.znany, false);
  assert.equal(w.ton, 'neutral');
});

test('MAKS_TERMINY: 30 / 90 / 120 dni', () => {
  assert.deepEqual(MAKS_TERMINY.map((m) => m.dni), [30, 90, 120]);
});
