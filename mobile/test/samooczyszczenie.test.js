import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ELEMENTY, ocenaSamooczyszczenia } from '../src/lib/samooczyszczenie.js';

test('ocenaSamooczyszczenia: komplet 3 elementów → kompletne (sukces)', () => {
  const w = ocenaSamooczyszczenia({ naprawa: true, wyjasnienie: true, srodki: true });
  assert.equal(w.kompletne, true);
  assert.equal(w.zrobione, 3);
  assert.equal(w.ton, 'sukces');
});

test('ocenaSamooczyszczenia: część zrobiona → ostrzeżenie z brakami', () => {
  const w = ocenaSamooczyszczenia({ naprawa: true, wyjasnienie: false, srodki: false });
  assert.equal(w.kompletne, false);
  assert.equal(w.zrobione, 1);
  assert.equal(w.braki.length, 2);
  assert.equal(w.ton, 'ostrzezenie');
});

test('ocenaSamooczyszczenia: nic nie zrobione → neutralny (start)', () => {
  const w = ocenaSamooczyszczenia({});
  assert.equal(w.zrobione, 0);
  assert.equal(w.ton, 'neutral');
  assert.equal(w.kompletne, false);
});

test('ELEMENTY: trzy wymagane (art. 110 ust. 2)', () => {
  assert.deepEqual(ELEMENTY.map((e) => e.klucz), ['naprawa', 'wyjasnienie', 'srodki']);
});
