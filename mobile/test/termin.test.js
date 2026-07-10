import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opisTerminu, opisOceny } from '../src/lib/termin.js';

/*
 * Audyt 2026-07-10 (HIGH ×2):
 *  • przetargi po terminie zostawały w feedzie bez żadnego oznaczenia —
 *    użytkownik widział ofertę, na którą nie mógł już złożyć wniosku;
 *  • aplikacja nie odróżniała oceny modelu od mechanicznego trafienia w słowo
 *    kluczowe, choć backend zapisuje `scorer`.
 */

const TERAZ = new Date('2026-07-10T12:00:00.000Z').getTime();
const za = (ms) => new Date(TERAZ + ms).toISOString();
const GODZINA = 3_600_000;
const DZIEN = 86_400_000;

test('termin miniony jest jawnie oznaczony', () => {
  const t = opisTerminu(za(-GODZINA), TERAZ);
  assert.equal(t.minal, true);
  assert.equal(t.stan, 'minal');
  assert.match(t.etykieta, /minął/i);
  assert.equal(t.pilny, false, 'miniony nie jest „pilny" — jest martwy');
});

test('termin dokładnie teraz liczy się jako miniony', () => {
  assert.equal(opisTerminu(za(0), TERAZ).minal, true);
});

test('mniej niż doba — liczymy godziny i oznaczamy jako pilne', () => {
  const t = opisTerminu(za(5 * GODZINA), TERAZ);
  assert.equal(t.stan, 'dzis');
  assert.equal(t.pilny, true);
  assert.match(t.etykieta, /5 godz/);
});

test('kilka dni — pilne do tygodnia włącznie', () => {
  assert.equal(opisTerminu(za(3 * DZIEN), TERAZ).pilny, true);
  assert.equal(opisTerminu(za(7 * DZIEN), TERAZ).pilny, true);
  assert.equal(opisTerminu(za(8 * DZIEN), TERAZ).pilny, false, 'ponad tydzień to nie jest pilne');
});

test('odległy termin podaje liczbę dni', () => {
  const t = opisTerminu(za(30 * DZIEN), TERAZ);
  assert.equal(t.stan, 'odlegly');
  assert.match(t.etykieta, /30 dni/);
});

test('brak terminu i śmieci nie wywracają karty', () => {
  for (const wartosc of [null, undefined, '', 'nie-data']) {
    const t = opisTerminu(wartosc, TERAZ);
    assert.equal(t.stan, 'brak');
    assert.equal(t.minal, false, 'brak terminu to NIE to samo co termin miniony');
    assert.ok(t.etykieta.length);
  }
});

test('opisOceny odróżnia AI od heurystyki', () => {
  assert.match(opisOceny('ai').etykieta, /AI/);
  assert.match(opisOceny('heuristic').etykieta, /automatyczne/i);
  assert.notEqual(opisOceny('ai').etykieta, opisOceny('heuristic').etykieta);
  // Nieznany scorer nie może udawać AI.
  assert.equal(opisOceny(undefined).etykieta, opisOceny('heuristic').etykieta);
});
