import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRZESLANKI, ocenaZastrzezenia } from '../src/lib/tajemnica.js';

test('ocenaZastrzezenia: trzy przesłanki spełnione → skuteczne (sukces)', () => {
  const w = ocenaZastrzezenia({ nazwa: 'Wykaz osób', wartosc: true, nieznane: true, dzialania: true });
  assert.equal(w.skuteczne, true);
  assert.equal(w.ton, 'sukces');
  assert.equal(w.braki.length, 0);
});

test('ocenaZastrzezenia: brak jednej przesłanki → nieskuteczne (danger)', () => {
  const w = ocenaZastrzezenia({ nazwa: 'Kosztorys', wartosc: true, nieznane: true, dzialania: false });
  assert.equal(w.skuteczne, false);
  assert.equal(w.ton, 'danger');
  assert.equal(w.braki.length, 1);
  assert.equal(w.braki[0].klucz, 'dzialania');
  assert.match(w.powod, /odtajni/i);
});

test('ocenaZastrzezenia: element jawny (cena/nazwa) → nie można zastrzec', () => {
  const w = ocenaZastrzezenia({ nazwa: 'Cena oferty', jawny: true, wartosc: true, nieznane: true, dzialania: true });
  assert.equal(w.skuteczne, false);
  assert.equal(w.jawny, true);
  assert.equal(w.ton, 'danger');
  assert.match(w.powod, /222 ust\. 5/);
});

test('PRZESLANKI: dokładnie trzy', () => {
  assert.equal(PRZESLANKI.length, 3);
  assert.deepEqual(PRZESLANKI.map((p) => p.klucz), ['wartosc', 'nieznane', 'dzialania']);
});
