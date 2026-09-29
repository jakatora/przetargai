import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StackRouter } from '@react-navigation/routers';
import {
  profilPusty, czyPokazacOnboarding, trasaStartowa, kluczNawigatora,
} from '../src/lib/onboarding.js';

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

// ── Po zalogowaniu (audyt 2026-09-29) ──────────────────────────────────────────
// React Navigation tworzy router RAZ (useLazyValue) z initialRouteName z chwili
// montażu — dla gościa to 'Login'. Po zalogowaniu 'Login' znika, a router spada
// na PIERWSZY ekran grupy zalogowanego, czyli 'Witaj': każdy użytkownik z gotowym
// profilem lądował na onboardingu. Naprawa: nawigator dostaje `key` zależny od
// sesji, więc przy logowaniu/wylogowaniu montuje się od nowa z właściwą trasą.

const TRASY_GOSCIA = ['Login', 'Register', 'ForgotPassword', 'ResetPassword'];
const TRASY_ZALOGOWANEGO = ['Witaj', 'MatchFeed', 'MatchDetail', 'Saved', 'Account'];
const zPelnymProfilem = { id: 'u1', keywords: ['droga'], cpv_codes: [] };
const nowy = { id: 'u2', keywords: [], cpv_codes: [] };

/** Symulacja montażu nawigatora tak, jak robi to React: nowy klucz = nowy router. */
function poZmianieSesji({ przed, po, pominiety = false }) {
  const router = StackRouter({ initialRouteName: trasaStartowa(przed, czyPokazacOnboarding(przed, pominiety)) });
  const stan = router.getInitialState({ routeNames: przed ? TRASY_ZALOGOWANEGO : TRASY_GOSCIA, routeParamList: {} });
  const trasyPo = po ? TRASY_ZALOGOWANEGO : TRASY_GOSCIA;
  if (kluczNawigatora(przed) === kluczNawigatora(po)) {
    // Ten sam klucz — React zachowuje router, a ten tylko przycina stos.
    const nowyStan = router.getStateForRouteNamesChange(stan, { routeNames: trasyPo, routeParamList: {}, routeKeyChanges: [] });
    return nowyStan.routes.map((r) => r.name);
  }
  const nowyRouter = StackRouter({ initialRouteName: trasaStartowa(po, czyPokazacOnboarding(po, pominiety)) });
  return nowyRouter.getInitialState({ routeNames: trasyPo, routeParamList: {} }).routes.map((r) => r.name);
}

test('kluczNawigatora: gość i zalogowany mają RÓŻNE klucze (logowanie montuje nawigator od nowa)', () => {
  assert.notEqual(kluczNawigatora(null), kluczNawigatora(zPelnymProfilem));
  assert.notEqual(kluczNawigatora(zPelnymProfilem), kluczNawigatora(nowy));
});

test('kluczNawigatora: edycja profilu tego samego konta NIE resetuje stosu', () => {
  assert.equal(kluczNawigatora(zPelnymProfilem), kluczNawigatora({ ...zPelnymProfilem, keywords: ['most'] }));
});

test('logowanie z gotowym profilem: główny widok, bez onboardingu i bez starego stosu', () => {
  assert.deepEqual(poZmianieSesji({ przed: null, po: zPelnymProfilem }), ['MatchFeed']);
});

test('logowanie nowego konta z pustym profilem: onboarding', () => {
  assert.deepEqual(poZmianieSesji({ przed: null, po: nowy }), ['Witaj']);
});

test('pusty profil, ale onboarding pominięty wcześniej: główny widok', () => {
  assert.deepEqual(poZmianieSesji({ przed: null, po: nowy, pominiety: true }), ['MatchFeed']);
});

test('wylogowanie: ekran logowania, stos zalogowanego znika', () => {
  assert.deepEqual(poZmianieSesji({ przed: zPelnymProfilem, po: null }), ['Login']);
});

test('RootNavigator: Stack.Navigator dostaje klucz sesji', () => {
  const zrodlo = readFileSync(new URL('../src/navigation/RootNavigator.js', import.meta.url), 'utf8');
  assert.match(zrodlo, /<Stack\.Navigator\s[^>]*key=\{kluczNawigatora\(user\)\}/);
});
