import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, bladOdpowiedzi, bladSieci } from '../src/api/errors.js';

/*
 * Audyt 2026-07-09 (HIGH ×2):
 *  • client.js nie odróżniał 401 od czegokolwiek innego — wygasły token w trakcie
 *    sesji nie wylogowywał, apka wisiała na ekranie błędu bez wyjścia;
 *  • AuthContext kasował zapisany token przy KAŻDYM błędzie /auth/me, także przy
 *    braku internetu, 429 i 500 — użytkownik w metrze tracił sesję na stałe.
 *
 * Żeby dało się to przetestować bez środowiska React Native, rozpoznawanie błędów
 * mieszka w module bez zależności RN.
 */

test('bladOdpowiedzi — 401 jest rozpoznawany jako wygaśnięcie sesji', () => {
  const err = bladOdpowiedzi(401, { error: { message: 'Nieprawidłowy lub wygasły token' } });
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 401);
  assert.equal(err.wygaslaSesja, true);
  assert.equal(err.bladSieci, false);
  assert.equal(err.message, 'Nieprawidłowy lub wygasły token');
});

test('bladOdpowiedzi — 500/429 NIE są wygaśnięciem sesji (token zostaje)', () => {
  for (const status of [429, 500, 502, 503]) {
    const err = bladOdpowiedzi(status, null);
    assert.equal(err.wygaslaSesja, false, `status ${status} nie może kasować sesji`);
    assert.equal(err.status, status);
  }
});

test('bladOdpowiedzi — używa komunikatu z backendu, gdy jest', () => {
  const err = bladOdpowiedzi(409, { error: { message: 'Konto z tym adresem email już istnieje' } });
  assert.equal(err.message, 'Konto z tym adresem email już istnieje');
});

test('bladOdpowiedzi — bez treści odpowiedzi daje czytelny komunikat zastępczy', () => {
  const err = bladOdpowiedzi(503, null);
  assert.match(err.message, /503/);
  assert.ok(err.message.length > 5, 'komunikat ma coś znaczyć dla użytkownika');
});

test('bladSieci — brak internetu to NIE wygaśnięcie sesji', () => {
  const err = bladSieci();
  assert.equal(err.bladSieci, true);
  assert.equal(err.wygaslaSesja, false, 'offline nie może wylogowywać użytkownika');
  assert.equal(err.status, 0);
  assert.match(err.message, /połączeni|internet/i);
});

test('ApiError — zachowuje się jak zwykły Error (message, instanceof, stack)', () => {
  const err = bladSieci();
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'ApiError');
  assert.ok(typeof err.stack === 'string');
});
