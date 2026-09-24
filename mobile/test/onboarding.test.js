import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profilPusty, czyPokazacOnboarding, trasaStartowa } from '../src/lib/onboarding.js';

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

// Regresja 2026-09-24: RootNavigator dawał `initialRouteName={pokaz ? 'Witaj' : undefined}`,
// a przy `undefined` React Navigation bierze PIERWSZY zarejestrowany ekran — czyli Witaj.
// Każdy zalogowany użytkownik z pełnym profilem lądował przy starcie na ekranie powitalnym.
test('trasaStartowa: pełny profil → feed, nigdy ekran powitalny', () => {
  assert.equal(trasaStartowa({ keywords: ['remont'], cpv_codes: [] }, false), 'MatchFeed');
});

test('trasaStartowa: onboarding wymagany → Witaj', () => {
  assert.equal(trasaStartowa({ keywords: [], cpv_codes: [] }, true), 'Witaj');
});

test('trasaStartowa: brak usera → Login (zawsze nazwana trasa, nigdy undefined)', () => {
  assert.equal(trasaStartowa(null, false), 'Login');
  assert.equal(trasaStartowa(null, true), 'Login');
});
