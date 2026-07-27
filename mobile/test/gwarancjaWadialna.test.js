import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WYMOGI, wymogiDla, ocenaGwarancji, werdykt } from '../src/lib/gwarancjaWadialna.js';

// Komplet odpowiedzi „spełnia" dla wszystkich wymogów (bez konsorcjum).
function wszystkoTak() {
  const o = {};
  for (const w of WYMOGI) o[w.klucz] = true;
  return o;
}

test('wymogiDla: konsorcjum tylko przy ofercie wspólnej', () => {
  assert.equal(wymogiDla({}).some((w) => w.klucz === 'konsorcjum'), false);
  assert.equal(wymogiDla({ konsorcjum: true }).some((w) => w.klucz === 'konsorcjum'), true);
});

test('ocenaGwarancji: komplet → gotowa (sukces)', () => {
  const w = ocenaGwarancji(wszystkoTak());
  assert.equal(w.gotowa, true);
  assert.equal(w.braki.length, 0);
  assert.equal(w.ton, 'sukces');
});

test('ocenaGwarancji: brak jednej przesłanki = krytyczny → danger, nie gotowa', () => {
  const o = wszystkoTak();
  o.przeslanka1 = false; // brak pkt 1
  const w = ocenaGwarancji(o);
  assert.equal(w.gotowa, false);
  assert.equal(w.krytyczneBraki, 1);
  assert.equal(w.ton, 'danger');
  assert.equal(w.braki[0].klucz, 'przeslanka1');
});

test('ocenaGwarancji: brak tylko formy (niekrytyczny) → ostrzeżenie, nie gotowa', () => {
  const o = wszystkoTak();
  o.forma = false;
  const w = ocenaGwarancji(o);
  assert.equal(w.gotowa, false);
  assert.equal(w.krytyczneBraki, 0);
  assert.equal(w.ton, 'ostrzezenie');
});

test('ocenaGwarancji: konsorcjum bez pokrycia członków = krytyczny brak', () => {
  const o = wszystkoTak();
  delete o.konsorcjum; // gwarancja NIE obejmuje członków konsorcjum
  const w = ocenaGwarancji(o, { konsorcjum: true });
  assert.equal(w.gotowa, false);
  assert.equal(w.braki.some((b) => b.klucz === 'konsorcjum'), true);
  assert.equal(w.krytyczneBraki, 1);
});

test('ocenaGwarancji: pusta odpowiedź → wszystkie wymogi brakują, danger', () => {
  const w = ocenaGwarancji({});
  assert.equal(w.gotowa, false);
  assert.ok(w.krytyczneBraki >= 5);
  assert.equal(w.ton, 'danger');
});

test('werdykt: komunikaty zależne od wyniku', () => {
  assert.match(werdykt(ocenaGwarancji(wszystkoTak())), /gotowa/i);
  const zBrakiem = ocenaGwarancji({ ...wszystkoTak(), waznosc: false });
  assert.match(werdykt(zBrakiem), /Nie wnoś/i);
});
