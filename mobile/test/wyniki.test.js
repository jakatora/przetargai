import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opisWyniki } from '../src/lib/wyniki.js';

/*
 * Prezentacja statystyk wyników (R17): „za taką robotę płacono X–Y, startowało ~N
 * firm, w Z% wygrywał mały". Brak danych → null (nie pokazujemy pustej sekcji).
 */

test('pełne dane → cena, konkurencja, % małych + podpis z próbką', () => {
  const w = opisWyniki({
    cena: { mediana: 250000, min: 100000, max: 500000, n: 12 },
    oferty: { mediana: 5, n: 20 },
    maly: { procent: 60, n: 15 },
    probka: 20,
  });
  assert.match(w.cena, /250\s?000/);
  assert.match(w.cena, /100\s?000/);
  assert.match(w.konkurencja, /5/);
  assert.match(w.maly, /60%/);
  assert.match(w.podpis, /20/);
});

test('sam licznik ofert bez cen → pokazujemy konkurencję, cena pominięta', () => {
  const w = opisWyniki({ cena: null, oferty: { mediana: 4, n: 8 }, maly: null, probka: 8 });
  assert.equal(w.cena, null);
  assert.match(w.konkurencja, /4/);
});

test('brak statystyki → null', () => {
  assert.equal(opisWyniki(null), null);
  assert.equal(opisWyniki(undefined), null);
});

test('bucket bez żadnej metryki → null (nic do pokazania)', () => {
  assert.equal(opisWyniki({ cena: null, oferty: null, maly: null, probka: 3 }), null);
});
