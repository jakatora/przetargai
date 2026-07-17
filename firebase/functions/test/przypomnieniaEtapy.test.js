import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nastepneRemind, ETAPY_DNI } from '../src/lib/przypomnienia.js';

/*
 * Przypomnienia wieloetapowe 7/3/1 dnia (runda 11) — parity z konkurencją.
 * Kluczowa subtelność: gdy user włącza przypomnienie późno (termin bliżej niż etap),
 * NIE odpalamy minionych etapów wstecz („za 7 dni", gdy zostały 3) — pomijamy je.
 */

const DZIEN = 86_400_000;
const T = (iso) => new Date(iso).getTime();
const iso = (ms) => new Date(ms).toISOString();

test('ETAPY_DNI = [7,3,1]', () => {
  assert.deepEqual(ETAPY_DNI, [7, 3, 1]);
});

test('deadline daleko: pierwszy remind to etap 7 dni', () => {
  const now = '2026-07-01T00:00:00.000Z';
  const deadline = iso(T(now) + 20 * DZIEN);
  const r = nastepneRemind(deadline, now, []);
  assert.equal(r.etap, 7);
  assert.equal(T(r.at), T(deadline) - 7 * DZIEN);
});

test('po wysłaniu 7 → następny to 3, potem 1', () => {
  const now = '2026-07-01T00:00:00.000Z';
  const deadline = iso(T(now) + 20 * DZIEN);
  assert.equal(nastepneRemind(deadline, now, [7]).etap, 3);
  assert.equal(nastepneRemind(deadline, now, [7, 3]).etap, 1);
  assert.equal(nastepneRemind(deadline, now, [7, 3, 1]), null, 'po wszystkich etapach koniec');
});

test('POŹNE włączenie: termin za 5 dni → pomijamy etap 7, zaczynamy od 3', () => {
  const now = '2026-07-01T00:00:00.000Z';
  const deadline = iso(T(now) + 5 * DZIEN);
  const r = nastepneRemind(deadline, now, []);
  assert.equal(r.etap, 3, 'nie „za 7 dni” wstecz — najbliższy przyszły etap');
  assert.equal(T(r.at), T(deadline) - 3 * DZIEN);
});

test('BARDZO późne włączenie: termin za 12 h → jeden remind ASAP (etap 0)', () => {
  const now = '2026-07-01T00:00:00.000Z';
  const deadline = iso(T(now) + DZIEN / 2);
  const r = nastepneRemind(deadline, now, []);
  assert.equal(r.etap, 0, 'wszystkie etapy minęły → ostatnie wezwanie');
  assert.equal(T(r.at), T(now), 'przypominamy natychmiast');
  assert.equal(nastepneRemind(deadline, now, [0]), null, 'ostatnie wezwanie tylko raz');
});

test('brak terminu / termin miniony → null', () => {
  assert.equal(nastepneRemind(null, '2026-07-01T00:00:00.000Z', []), null);
  const now = '2026-07-01T00:00:00.000Z';
  assert.equal(nastepneRemind(iso(T(now) - DZIEN), now, []), null, 'po terminie');
});

test('normalna ścieżka NIE dokłada etapu 0 po wysłaniu 1 (bez podwójnego wezwania)', () => {
  const now = '2026-07-01T00:00:00.000Z';
  const deadline = iso(T(now) + 20 * DZIEN);
  assert.equal(nastepneRemind(deadline, now, [7, 3, 1]), null, 'po 1-dniowym koniec, żadnego etapu 0');
});
