import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ELEMENTY,
  ocenaSamooczyszczenia,
  PODSTAWY_110,
  czyObjeteSamooczyszczeniem,
  WSTEP,
  UWAGA_ZALEGLOSCI,
} from '../src/lib/samooczyszczenie.js';

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

// ─── zakres art. 110 ust. 2 (2026-09-25) ────────────────────────────────────
// Ekran obiecywał procedurę naprawczą przy zaległościach ZUS/US — błąd prawny: art. 110
// ust. 2 obejmuje tylko art. 108 ust. 1 pkt 1, 2, 5 i art. 109 ust. 1 pkt 2–5, 7–10.

test('PODSTAWY_110: zamknięta lista z art. 110 ust. 2 Pzp', () => {
  assert.deepEqual([...PODSTAWY_110.art108], [1, 2, 5]);
  assert.deepEqual([...PODSTAWY_110.art109], [2, 3, 4, 5, 7, 8, 9, 10]);
});

test('czyObjeteSamooczyszczeniem: zaległości podatkowe/ZUS (108.1.3, 109.1.1) — NIE', () => {
  assert.equal(czyObjeteSamooczyszczeniem(108, 3), false);
  assert.equal(czyObjeteSamooczyszczeniem(109, 1), false);
  assert.equal(czyObjeteSamooczyszczeniem(109, 6), false, 'konflikt interesów — poza art. 110 ust. 2');
  assert.equal(czyObjeteSamooczyszczeniem(108, 1), true);
  assert.equal(czyObjeteSamooczyszczeniem(109, 7), true, 'nienależyte wykonanie wcześniejszej umowy');
  assert.equal(czyObjeteSamooczyszczeniem('109', '5'), true);
  assert.equal(czyObjeteSamooczyszczeniem(226, 1), false);
});

test('WSTEP ekranu: nie obiecuje samooczyszczenia przy zaległościach ZUS/US', () => {
  assert.doesNotMatch(WSTEP, /ZUS|\bUS\b/);
  assert.doesNotMatch(WSTEP, /zaległoś|podatk|składek/i);
  assert.match(WSTEP, /art\. 110 ust\. 2/i);
});

test('UWAGA_ZALEGLOSCI: zapłata albo wiążące porozumienie PRZED terminem składania ofert', () => {
  assert.match(UWAGA_ZALEGLOSCI, /ZUS/);
  assert.match(UWAGA_ZALEGLOSCI, /art\. 108 ust\. 1 pkt 3/);
  assert.match(UWAGA_ZALEGLOSCI, /art\. 109 ust\. 1 pkt 1/);
  assert.match(UWAGA_ZALEGLOSCI, /zapła/i);
  assert.match(UWAGA_ZALEGLOSCI, /wiążące porozumienie/);
  assert.match(UWAGA_ZALEGLOSCI, /przed upływem terminu składania ofert/);
  assert.match(UWAGA_ZALEGLOSCI, /nie (?:pomoże|obejmuje|działa)/i);
});
