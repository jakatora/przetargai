import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sprawdzKonsorcjum, werdyktKonsorcjum } from '../src/lib/konsorcjum.js';

test('sprawdzKonsorcjum: potwierdza = wykonuje → spójne (sukces)', () => {
  const w = sprawdzKonsorcjum([
    { nazwa: 'Doświadczenie roboty', potwierdza: 'Firma A', wykonuje: 'Firma A' },
    { nazwa: 'Uprawnienia', potwierdza: 'Firma B', wykonuje: 'Firma B' },
  ]);
  assert.equal(w.spojne, true);
  assert.equal(w.bledy.length, 0);
  assert.equal(w.sprawdzone, 2);
  assert.equal(w.ton, 'sukces');
});

test('sprawdzKonsorcjum: potwierdza kto inny niż wykonuje → błąd (danger)', () => {
  const w = sprawdzKonsorcjum([
    { nazwa: 'Doświadczenie roboty', potwierdza: 'Firma A', wykonuje: 'Firma B' },
  ]);
  assert.equal(w.spojne, false);
  assert.equal(w.bledy.length, 1);
  assert.equal(w.bledy[0].potwierdza, 'Firma A');
  assert.equal(w.bledy[0].wykonuje, 'Firma B');
  assert.equal(w.ton, 'danger');
});

test('sprawdzKonsorcjum: puste wiersze pomijane', () => {
  const w = sprawdzKonsorcjum([{ potwierdza: '', wykonuje: '' }, { nazwa: 'X' }]);
  assert.equal(w.sprawdzone, 0);
  assert.equal(w.spojne, false);
  assert.equal(w.ton, 'neutral');
});

test('sprawdzKonsorcjum: brak przypisania wykonawcy = błąd', () => {
  const w = sprawdzKonsorcjum([{ nazwa: 'Doświadczenie', potwierdza: 'Firma A', wykonuje: '' }]);
  assert.equal(w.bledy.length, 1);
  assert.equal(w.spojne, false);
});

test('werdyktKonsorcjum: komunikaty', () => {
  assert.match(werdyktKonsorcjum(sprawdzKonsorcjum([])), /Dodaj warunki/i);
  assert.match(werdyktKonsorcjum(sprawdzKonsorcjum([{ nazwa: 'X', potwierdza: 'A', wykonuje: 'A' }])), /spójne/i);
  assert.match(werdyktKonsorcjum(sprawdzKonsorcjum([{ nazwa: 'X', potwierdza: 'A', wykonuje: 'B' }])), /Sprzeczność/i);
});
