import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profilPusty, czyPokazacOnboarding } from '../src/lib/onboarding.js';

test('profilPusty: brak słów i CPV = pusty', () => {
  assert.equal(profilPusty({ keywords: [], cpv_codes: [] }), true);
  assert.equal(profilPusty({}), true);
  assert.equal(profilPusty(null), true);
});

test('profilPusty: cokolwiek wypełnione = niepusty', () => {
  assert.equal(profilPusty({ keywords: ['droga'], cpv_codes: [] }), false);
  assert.equal(profilPusty({ keywords: [], cpv_codes: ['45000000'] }), false);
});

test('czyPokazacOnboarding: nowy user z pustym profilem → tak', () => {
  assert.equal(czyPokazacOnboarding({ keywords: [], cpv_codes: [] }, false), true);
});

test('czyPokazacOnboarding: profil uzupełniony → nie (warunek sam wygasa)', () => {
  assert.equal(czyPokazacOnboarding({ keywords: ['remont'], cpv_codes: [] }, false), false);
});

test('czyPokazacOnboarding: pominięty wcześniej → nie (bez nękania)', () => {
  assert.equal(czyPokazacOnboarding({ keywords: [], cpv_codes: [] }, true), false);
});

test('czyPokazacOnboarding: brak usera → nie', () => {
  assert.equal(czyPokazacOnboarding(null, false), false);
});
