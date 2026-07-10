import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROGI, filtrujPoProgu, normalizujProg } from '../src/lib/filtrOcen.js';

/*
 * Filtr „pokaż od X% dopasowania" (życzenie usera 2026-07-10, po zakupie
 * Standard: pełny feed potrzebuje sita na najlepsze okazje).
 */

const FEED = [
  { id: 'a', confidence_score: 62 },
  { id: 'b', confidence_score: 75 },
  { id: 'c', confidence_score: 89 },
  { id: 'd', confidence_score: 95 },
];

test('prog 0 = wszystkie (bez kopiowania problemów z pustym feedem)', () => {
  assert.equal(filtrujPoProgu(FEED, 0).length, 4);
});

test('prog tnie poniżej wartości, granica WŁĄCZNIE', () => {
  assert.deepEqual(filtrujPoProgu(FEED, 80).map((m) => m.id), ['c', 'd']);
  assert.deepEqual(filtrujPoProgu(FEED, 89).map((m) => m.id), ['c', 'd'], '89 wchodzi przy progu 89');
});

test('brak oceny traktowany jak 0 — nie przechodzi przez próg', () => {
  assert.equal(filtrujPoProgu([{ id: 'x' }], 70).length, 0);
});

test('normalizujProg: tylko zdefiniowane progi, śmieci wracają do 0', () => {
  assert.equal(normalizujProg('80'), 80);
  assert.equal(normalizujProg(70), 70);
  assert.equal(normalizujProg('55'), 0, 'wartość spoza listy = Wszystkie');
  assert.equal(normalizujProg(null), 0);
  assert.equal(normalizujProg('abc'), 0);
});

test('PROGI: pierwsza opcja to zawsze „Wszystkie" (0)', () => {
  assert.equal(PROGI[0].wartosc, 0);
  assert.ok(PROGI.length >= 3, 'sensowny wybór progów');
});
