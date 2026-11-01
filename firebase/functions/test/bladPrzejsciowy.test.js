import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bladPrzejsciowy } from '../src/lib/bladPrzejsciowy.js';

/* Błąd pobrania PDF-a: przejściowy (plik wraca w kolejnej próbie) czy trwały (plik oznaczony jako przeczytany). */
test('403/429/5xx, limit czasu i sieć są przejściowe; nie-PDF, rozmiar i adres — trwałe', () => {
  for (const m of ['Pobranie SWZ: HTTP 403', 'Pobranie SWZ: HTTP 503', 'e-Zamówienia odpowiedziały 429', 'The operation was aborted due to timeout', 'fetch failed', 'connect ECONNRESET']) {
    assert.equal(bladPrzejsciowy(new Error(m)), true, m);
  }
  assert.equal(bladPrzejsciowy(Object.assign(new Error('x'), { przejsciowy: true })), true);
  for (const m of ['Pobrany plik nie jest PDF-em', 'SWZ ma 9 MB — limit 5 MB', 'Pobranie SWZ: niedozwolony adres', 'Invalid PDF structure']) {
    assert.equal(bladPrzejsciowy(new Error(m)), false, m);
  }
  assert.equal(bladPrzejsciowy(null), false);
});
