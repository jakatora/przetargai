import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podsumujStart, KROKI_STARTU, wczytajStart, zapiszStart } from '../src/lib/przewodnikStartu.js';

test('pusty przewodnik → 0%, nie gotowe, wszystkie kroki obecne', () => {
  const w = podsumujStart(new Set());
  assert.equal(w.zrobione, 0);
  assert.equal(w.procent, 0);
  assert.equal(w.gotowe, false);
  assert.equal(w.pozycje.length, KROKI_STARTU.length);
});

test('część zaznaczona → procent; komplet → 100% i gotowe', () => {
  const cz = podsumujStart(['firma', 'podpis']);
  assert.equal(cz.zrobione, 2);
  assert.equal(cz.gotowe, false);
  const all = podsumujStart(new Set(KROKI_STARTU.map((k) => k.klucz)));
  assert.equal(all.procent, 100);
  assert.equal(all.gotowe, true);
});

test('kroki z linkiem wskazują istniejący ekran', () => {
  const EKRANY = new Set(['Sejf', 'Account']);
  for (const k of KROKI_STARTU) {
    if (k.ekran) assert.ok(EKRANY.has(k.ekran), `nieznany ekran: ${k.ekran}`);
  }
});

test('zapisz → wczytaj round-trip + odporność na śmieci', async () => {
  const mapa = new Map();
  const storage = { getItem: async (k) => (mapa.has(k) ? mapa.get(k) : null), setItem: async (k, v) => { mapa.set(k, v); } };
  await zapiszStart(storage, new Set(['firma', 'platforma']));
  const s = await wczytajStart(storage);
  assert.deepEqual([...s].sort(), ['firma', 'platforma']);
});
