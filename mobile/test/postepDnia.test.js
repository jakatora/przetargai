import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postepDnia, podpisPostepu, opisGotowego } from '../src/lib/postepDnia.js';

const m = (id, status) => ({ id, status });

test('postęp: razem z raportu (odrzucone znikają z listy), czekające przed wziętymi', () => {
  const wziete = new Set(['b']);
  const p = postepDnia({ wybrane: [m('a'), m('b'), m('c')], raportWybrane: 4, czyWziety: (x) => wziete.has(x.id) });
  assert.deepEqual([p.razem, p.zostalo, p.zdecydowane, p.wziete, p.gotowe], [4, 2, 2, 1, false]);
  assert.deepEqual(p.kolejnosc.map((x) => x.id), ['a', 'c', 'b']);
  assert.deepEqual(podpisPostepu(p), { pl: 'Do decyzji: 2 z 4', en: 'Left to decide: 2 of 4' });
});

test('gotowe: wszystko wzięte albo odrzucone; bez wyboru — nie „gotowe”', () => {
  const p = postepDnia({ wybrane: [m('a', 'przygotowuje')], raportWybrane: 3, czyWziety: (x) => x.status === 'przygotowuje' });
  assert.equal(p.gotowe, true);
  assert.equal(podpisPostepu(p), null);
  assert.equal(opisGotowego(p).pl, 'Wszystkie 3 dzisiejsze przetargi mają decyzję. Bierzesz 1 — jest w Zapisanych z przypomnieniami przed terminem.');
  assert.equal(opisGotowego({ razem: 5, wziete: 0 }).pl, 'Wszystkie 5 dzisiejszych przetargów ma decyzję. Żadnego dziś nie bierzesz — Twoje przyczyny poprawią jutrzejszy wybór.');
  assert.equal(opisGotowego({ razem: 1, wziete: 1 }).pl.split('.')[0], 'Dzisiejszy przetarg ma decyzję');
  assert.match(opisGotowego({ razem: 12, wziete: 2 }).pl, /^Wszystkie 12 dzisiejszych przetargów ma decyzję\. Bierzesz 2 — są/);
  assert.equal(postepDnia({ wybrane: [], raportWybrane: 0 }).gotowe, false);
  assert.equal(postepDnia({ wybrane: [m('a')], raportWybrane: 0 }).razem, 1, 'raport starszy niż lista — liczymy listę');
});

test('wszystko odrzucone: lista pusta, ale raport mówi o 3 wybranych → „gotowe”, a nie „nic nie pasuje”', () => {
  const p = postepDnia({ wybrane: [], raportWybrane: 3 });
  assert.deepEqual([p.gotowe, p.razem, p.wziete, p.zostalo], [true, 3, 0, 0]);
  assert.match(opisGotowego(p).pl, /Żadnego dziś nie bierzesz/);
});
