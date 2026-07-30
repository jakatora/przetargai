import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  podsumujKontrole, KONTROLE, kluczKontroli, wczytajKontroleOferty, zapiszKontroleOferty,
} from '../src/lib/kontrolaOferty.js';

test('pusta kontrola → 0%, nie gotowe, wszystkie pozycje obecne', () => {
  const w = podsumujKontrole(new Set());
  assert.equal(w.zrobione, 0);
  assert.equal(w.procent, 0);
  assert.equal(w.gotowe, false);
  assert.equal(w.pozycje.length, KONTROLE.length);
  assert.ok(w.pozycje.every((p) => p.wykonany === false));
});

test('część zaznaczona → poprawny procent', () => {
  const w = podsumujKontrole(['podpis', 'wadium']);
  assert.equal(w.zrobione, 2);
  assert.equal(w.procent, Math.round((100 * 2) / KONTROLE.length));
  assert.equal(w.gotowe, false);
});

test('wszystko zaznaczone → 100% i gotowe', () => {
  const w = podsumujKontrole(new Set(KONTROLE.map((k) => k.klucz)));
  assert.equal(w.procent, 100);
  assert.equal(w.gotowe, true);
});

test('kluczKontroli czyści znaki niedozwolone w SecureStore', () => {
  const k = kluczKontroli('ted:515-2026');
  assert.doesNotMatch(k, /[^A-Za-z0-9._-]/);
  assert.match(k, /^przetargai\.kontrola-oferty\./);
});

test('zapisz → wczytaj round-trip (fałszywy storage) + odporność na śmieci', async () => {
  const mapa = new Map();
  const storage = { getItem: async (k) => (mapa.has(k) ? mapa.get(k) : null), setItem: async (k, v) => { mapa.set(k, v); } };
  await zapiszKontroleOferty(storage, 'ted:1-2026', new Set(['podpis', 'platforma']));
  const s = await wczytajKontroleOferty(storage, 'ted:1-2026');
  assert.deepEqual([...s].sort(), ['platforma', 'podpis']);
  assert.equal((await wczytajKontroleOferty(storage, 'brak')).size, 0);
  mapa.set(kluczKontroli('zly'), '{zepsuty');
  assert.equal((await wczytajKontroleOferty(storage, 'zly')).size, 0);
});
