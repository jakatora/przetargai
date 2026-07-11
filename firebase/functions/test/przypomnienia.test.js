import { test } from 'node:test';
import assert from 'node:assert/strict';

import { obliczRemindAt, LEAD_MS } from '../src/lib/przypomnienia.js';

/*
 * Przypomnienie o terminie składania ofert (życzenie usera 2026-07-10):
 * użytkownik zapisuje przetarg i włącza „przypomnij przed terminem".
 * Domyślnie przypominamy 48 h przed deadline; gdy do terminu jest mniej,
 * przypominamy jak najszybciej (ale NIGDY po terminie).
 */

const T = (iso) => new Date(iso).getTime();

test('standardowo: 48 h przed terminem', () => {
  const now = '2026-07-10T12:00:00.000Z';
  const deadline = '2026-07-20T10:00:00.000Z';
  const r = obliczRemindAt(deadline, now);
  assert.equal(T(r), T(deadline) - LEAD_MS, 'remind_at = deadline − 48 h');
});

test('termin bliżej niż 48 h: przypomnij TERAZ, nie w przeszłości', () => {
  const now = '2026-07-10T12:00:00.000Z';
  const deadline = '2026-07-11T06:00:00.000Z'; // 18 h do terminu
  const r = obliczRemindAt(deadline, now);
  assert.equal(r, now, 'remind_at nie może być przed „teraz”');
});

test('termin już minął → null (nie ma o czym przypominać)', () => {
  const now = '2026-07-10T12:00:00.000Z';
  assert.equal(obliczRemindAt('2026-07-10T09:00:00.000Z', now), null);
});

test('termin dokładnie „teraz” → null', () => {
  const now = '2026-07-10T12:00:00.000Z';
  assert.equal(obliczRemindAt(now, now), null);
});

test('brak terminu → null (przetarg bez deadline istnieje)', () => {
  const now = '2026-07-10T12:00:00.000Z';
  assert.equal(obliczRemindAt(null, now), null);
  assert.equal(obliczRemindAt(undefined, now), null);
  assert.equal(obliczRemindAt('', now), null);
});

test('niepoprawny znacznik → null (nie wywalamy zapisu)', () => {
  assert.equal(obliczRemindAt('jutro', '2026-07-10T12:00:00.000Z'), null);
});

test('wynik jest kanonicznym ISO w UTC', () => {
  const r = obliczRemindAt('2026-07-20T10:00:00.000Z', '2026-07-10T12:00:00.000Z');
  assert.match(r, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
