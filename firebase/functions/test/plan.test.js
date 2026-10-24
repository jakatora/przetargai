import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBA_DNI, probaDo, planEfektywny, stanProby } from '../src/lib/plan.js';

const REJESTRACJA = '2026-10-20T10:00:00.000Z';
const KONIEC = probaDo(REJESTRACJA);

test('próba trwa dokładnie 7 dni od rejestracji', () => {
  assert.equal(PROBA_DNI, 7);
  assert.equal(KONIEC, '2026-10-27T10:00:00.000Z');
});

test('planEfektywny: płatny Standard zawsze standard, także bez próby', () => {
  assert.equal(planEfektywny({ premium_tier: 'standard' }, '2026-10-21T00:00:00.000Z'), 'standard');
});

test('planEfektywny: Free w trakcie próby = standard, tuż przed końcem też', () => {
  const u = { premium_tier: 'free', proba_do: KONIEC };
  assert.equal(planEfektywny(u, '2026-10-21T00:00:00.000Z'), 'standard');
  assert.equal(planEfektywny(u, '2026-10-27T09:59:59.999Z'), 'standard');
});

test('planEfektywny: dokładnie w chwili końca i po końcu = free (Review Focus 5)', () => {
  const u = { premium_tier: 'free', proba_do: KONIEC };
  assert.equal(planEfektywny(u, KONIEC), 'free');
  assert.equal(planEfektywny(u, '2026-10-28T00:00:00.000Z'), 'free');
});

test('planEfektywny: konto bez próby (sprzed wdrożenia, testowe) = free', () => {
  assert.equal(planEfektywny({ premium_tier: 'free' }, '2026-10-21T00:00:00.000Z'), 'free');
  assert.equal(planEfektywny({ premium_tier: 'free', proba_do: null }, '2026-10-21T00:00:00.000Z'), 'free');
  assert.equal(planEfektywny({ premium_tier: 'free', proba_do: 'śmieci' }, '2026-10-21T00:00:00.000Z'), 'free');
});

test('stanProby: null bez próby; dni zaokrąglone w górę; po końcu nieaktywna z 0 dni', () => {
  assert.equal(stanProby({ premium_tier: 'free' }), null);
  assert.deepEqual(stanProby({ premium_tier: 'free', proba_do: KONIEC }, '2026-10-25T09:00:00.000Z'),
    { aktywna: true, do: KONIEC, dni_zostalo: 3 });
  assert.deepEqual(stanProby({ premium_tier: 'free', proba_do: KONIEC }, '2026-10-28T00:00:00.000Z'),
    { aktywna: false, do: KONIEC, dni_zostalo: 0 });
});

test('stanProby: zakup w trakcie próby = próba nieaktywna (płaci, nie próbuje)', () => {
  assert.equal(stanProby({ premium_tier: 'standard', proba_do: KONIEC }, '2026-10-21T00:00:00.000Z').aktywna, false);
});
