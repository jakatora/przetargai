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

/*
 * Poprawka 2026-09-25 (P1 z recenzji): dni zaokrąglane W GÓRĘ z różnicy chwil —
 * termin jutro o 11:00 przy „teraz" pon 10:00 dawał „Zostały 2 dni". Liczymy różnicę dni
 * KALENDARZOWYCH w strefie Europe/Warsaw. Chwile jawnie w UTC (lipiec = CEST, UTC+2).
 * Poniedziałek 2026-07-13, 10:00 czasu polskiego:
 */
const PON_10_PL = Date.UTC(2026, 6, 13, 8, 0);
const GODZ = (n) => n * GODZINA;

test('termin jutro o 11:00, teraz pon 10:00 → „Termin jutro" (nie „Zostały 2 dni")', () => {
  const t = opisTerminu('2026-07-14T09:00:00Z', PON_10_PL); // wt 11:00 PL
  assert.equal(t.stan, 'jutro');
  assert.equal(t.etykieta, 'Termin jutro');
  assert.equal(t.pilny, true);
  assert.equal(t.minal, false);
});

test('jutro rano, choć do terminu mniej niż doba → nadal „Termin jutro" (dzień kalendarzowy)', () => {
  const pon20 = Date.UTC(2026, 6, 13, 18, 0); // pon 20:00 PL
  const t = opisTerminu('2026-07-14T08:00:00Z', pon20); // wt 10:00 PL, za 14 h
  assert.equal(t.stan, 'jutro');
  assert.equal(t.etykieta, 'Termin jutro');
});

test('po polskiej północy termin z tego dnia jest „dziś", choć w UTC to jeszcze wczoraj', () => {
  const wt0030 = Date.UTC(2026, 6, 13, 22, 30); // wt 00:30 PL = pon 22:30 UTC
  const t = opisTerminu('2026-07-14T09:00:00Z', wt0030); // wt 11:00 PL, za 10,5 h
  assert.equal(t.stan, 'dzis');
  assert.equal(t.etykieta, 'Zostało 10 godz.', 'godziny w dół — bez zawyżania');
});

test('pojutrze to już nie „jutro": 2 dni kalendarzowe → wkrotce, „Zostały 2 dni"', () => {
  const t = opisTerminu('2026-07-15T07:00:00Z', PON_10_PL); // śr 09:00 PL (47 h)
  assert.equal(t.stan, 'wkrotce');
  assert.equal(t.etykieta, 'Zostały 2 dni');
  assert.equal(t.pilny, true);
});

test('odmiana „Zostały/Zostało N dni"', () => {
  const zaDni = (n) => new Date(PON_10_PL + n * DZIEN).toISOString();
  assert.equal(opisTerminu(zaDni(3), PON_10_PL).etykieta, 'Zostały 3 dni');
  assert.equal(opisTerminu(zaDni(4), PON_10_PL).etykieta, 'Zostały 4 dni');
  assert.equal(opisTerminu(zaDni(5), PON_10_PL).etykieta, 'Zostało 5 dni');
  assert.equal(opisTerminu(zaDni(12), PON_10_PL).etykieta, 'Zostało 12 dni');
  assert.equal(opisTerminu(zaDni(14), PON_10_PL).etykieta, 'Zostało 14 dni');
  assert.equal(opisTerminu(zaDni(22), PON_10_PL).etykieta, 'Zostały 22 dni');
  assert.equal(opisTerminu(zaDni(25), PON_10_PL).etykieta, 'Zostało 25 dni');
});

test('godziny dziś: odmiana, poprawna „Została godzina", mniej niż godzina', () => {
  const zaMs = (ms) => new Date(PON_10_PL + ms).toISOString();
  assert.equal(opisTerminu(zaMs(GODZ(3)), PON_10_PL).etykieta, 'Zostały 3 godz.');
  assert.equal(opisTerminu(zaMs(GODZ(5)), PON_10_PL).etykieta, 'Zostało 5 godz.');
  assert.equal(opisTerminu(zaMs(GODZ(1.5)), PON_10_PL).etykieta, 'Została godzina');
  assert.equal(opisTerminu(zaMs(GODZ(0.5)), PON_10_PL).etykieta, 'Mniej niż godzina');
  assert.equal(opisTerminu(zaMs(GODZ(0.5)), PON_10_PL).stan, 'dzis');
});

test('sam dzień bez godziny: termin trwa do 24:00 czasu polskiego', () => {
  assert.equal(opisTerminu('2026-07-13', PON_10_PL).stan, 'dzis');
  assert.equal(opisTerminu('2026-07-13', PON_10_PL).etykieta, 'Termin dziś');
  assert.equal(opisTerminu('2026-07-13', PON_10_PL).minal, false, 'rano dnia terminu jeszcze nie minął');
  assert.equal(opisTerminu('2026-07-13', Date.UTC(2026, 6, 13, 22, 0)).minal, true, '24:00 PL');
  assert.equal(opisTerminu('2026-07-14', PON_10_PL).etykieta, 'Termin jutro');
  assert.equal(opisTerminu('14.07.2026', PON_10_PL).etykieta, 'Termin jutro');
});

test('godzina bez strefy = czas polski (np. termin_skladania z ogłoszeń podprogowych)', () => {
  const t = opisTerminu('2026-07-13 12:00:00', PON_10_PL); // 12:00 PL, za 2 h
  assert.equal(t.stan, 'dzis');
  assert.equal(t.etykieta, 'Zostały 2 godz.');
});

test('kształt wyniku bez zmian (karty feedu, agenda, katalog)', () => {
  for (const d of [null, '2026-07-01T00:00:00Z', '2026-07-13T12:00:00Z', '2026-07-14T09:00:00Z', '2026-08-30T09:00:00Z']) {
    assert.deepEqual(Object.keys(opisTerminu(d, PON_10_PL)).sort(), ['etykieta', 'minal', 'pilny', 'stan']);
  }
});

test('brak terminu i śmieci nie wywracają karty', () => {
  for (const wartosc of [null, undefined, '', 'nie-data', '07/14/2026', '2026-7-14']) {
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
