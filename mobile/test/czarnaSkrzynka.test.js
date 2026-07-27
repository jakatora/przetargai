import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REKOMENDACJA_GODZIN,
  PROG_KRYTYCZNY_GODZIN,
  KROKI_REJESTRATORA,
  odliczanieBezpieczenstwa,
  TYPY_AWARII,
  opisAwarii,
  opisDowodu,
  formatZnacznik,
} from '../src/lib/czarnaSkrzynka.js';

/*
 * CZARNA SKRZYNKA SKŁADANIA OFERTY — panel mobilny (podzadanie 7/7). Czysta logika
 * ekranu „Rejestrator oferty": kolejność kroków przewodnika, formatowanie odliczania
 * czasu bezpieczeństwa (rekomendacja 24 h przed terminem) oraz etykiety statusu
 * awarii i utrwalonych dowodów. Bez Reacta — ekran RejestratorOfertyScreen tylko to
 * renderuje, a kolor dokłada z tokenów motyw.js przez semantyczny `ton`.
 *
 * Progi muszą być spójne z backendem services/czasBezpieczenstwa.js (24 h rekomendacja,
 * 3 h próg krytyczny), bo to ta sama obietnica „ile czasu bezpieczeństwa zostało".
 */

const H = 3600 * 1000;
// Stały moment odniesienia ze strefą — instant jednoznaczny (patrz naMoment w backendzie).
const TERAZ = Date.parse('2026-07-27T12:00:00+02:00');
const oIle = (ms) => new Date(TERAZ + ms).toISOString();

// ---------------- KROKI_REJESTRATORA: kolejność kroków przewodnika ----------------

test('KROKI_REJESTRATORA: niepusta, zamrożona lista uporządkowanych kroków', () => {
  assert.ok(Array.isArray(KROKI_REJESTRATORA) && KROKI_REJESTRATORA.length >= 3);
  assert.ok(Object.isFrozen(KROKI_REJESTRATORA));
  // Każdy krok ma id, tytuł, opis i typ zdarzenia dopisywanego do taśmy.
  for (const krok of KROKI_REJESTRATORA) {
    assert.equal(typeof krok.id, 'string');
    assert.ok(krok.tytul && krok.opis && krok.typZdarzenie);
    assert.ok(Object.isFrozen(krok));
  }
});

test('KROKI_REJESTRATORA: id-ki są unikalne (stabilny klucz listy)', () => {
  const idki = KROKI_REJESTRATORA.map((k) => k.id);
  assert.equal(new Set(idki).size, idki.length);
});

test('KROKI_REJESTRATORA: zabezpieczenie oferty poprzedza wysyłkę i EPO', () => {
  const idx = (id) => KROKI_REJESTRATORA.findIndex((k) => k.id === id);
  assert.ok(idx('oferta') >= 0 && idx('wysylka') >= 0 && idx('epo') >= 0);
  assert.ok(idx('oferta') < idx('wysylka'), 'hash oferty musi być przed wysyłką');
  assert.ok(idx('wysylka') < idx('epo'), 'EPO potwierdza wysyłkę, więc jest po niej');
});

// ---------------- odliczanieBezpieczenstwa: progi + ton + formatowanie ----------------

test('stałe progów są spójne z backendem (24 h / 3 h)', () => {
  assert.equal(REKOMENDACJA_GODZIN, 24);
  assert.equal(PROG_KRYTYCZNY_GODZIN, 3);
});

test('odliczanieBezpieczenstwa: > 24 h → bezpiecznie (ton sukces)', () => {
  const w = odliczanieBezpieczenstwa(oIle(48 * H), TERAZ);
  assert.equal(w.status, 'bezpiecznie');
  assert.equal(w.ton, 'sukces');
  assert.equal(w.poTerminie, false);
  assert.match(w.odliczanie, /2 dni/);
});

test('odliczanieBezpieczenstwa: między 3 a 24 h → ostrzeżenie (ton ostrzezenie)', () => {
  const w = odliczanieBezpieczenstwa(oIle(10 * H), TERAZ);
  assert.equal(w.status, 'ostrzezenie');
  assert.equal(w.ton, 'ostrzezenie');
  assert.match(w.odliczanie, /10 godz/);
});

test('odliczanieBezpieczenstwa: < 3 h → krytycznie (ton danger)', () => {
  const w = odliczanieBezpieczenstwa(oIle(2 * H), TERAZ);
  assert.equal(w.status, 'krytycznie');
  assert.equal(w.ton, 'danger');
  assert.match(w.odliczanie, /2 godz/);
});

test('odliczanieBezpieczenstwa: po terminie → po_terminie (ton danger, poTerminie=true)', () => {
  const w = odliczanieBezpieczenstwa(oIle(-3 * H), TERAZ);
  assert.equal(w.status, 'po_terminie');
  assert.equal(w.ton, 'danger');
  assert.equal(w.poTerminie, true);
  assert.match(w.odliczanie, /po terminie/i);
});

test('odliczanieBezpieczenstwa: dokładnie na granicy 24 h to jeszcze bezpiecznie', () => {
  assert.equal(odliczanieBezpieczenstwa(oIle(24 * H), TERAZ).status, 'bezpiecznie');
  // Sekundę poniżej progu 24 h → już ostrzeżenie.
  assert.equal(odliczanieBezpieczenstwa(oIle(24 * H - 1000), TERAZ).status, 'ostrzezenie');
});

test('odliczanieBezpieczenstwa: brak/niepoprawny termin → status brak (ton neutralny)', () => {
  for (const z12 of [null, undefined, '', 'nie-data']) {
    const w = odliczanieBezpieczenstwa(z12, TERAZ);
    assert.equal(w.status, 'brak');
    assert.equal(w.ton, 'neutral');
  }
});

test('odliczanieBezpieczenstwa: wynik jest zamrożony (migawka)', () => {
  assert.ok(Object.isFrozen(odliczanieBezpieczenstwa(oIle(H), TERAZ)));
});

test('odliczanieBezpieczenstwa: rekomenduje złożenie 24 h przed terminem', () => {
  const w = odliczanieBezpieczenstwa(oIle(48 * H), TERAZ);
  assert.match(w.rekomendacja, /24/);
});

// ---------------- opisAwarii: etykiety statusu awarii ----------------

test('opisAwarii: znane typy mają etykietę i ton danger', () => {
  assert.equal(opisAwarii('blad_wysylki').ton, 'danger');
  assert.equal(opisAwarii('brak_epo').ton, 'danger');
  assert.equal(opisAwarii('niedostepnosc').ton, 'danger');
  assert.equal(opisAwarii('blad_wysylki'), TYPY_AWARII.blad_wysylki);
  assert.ok(opisAwarii('brak_epo').etykieta.length > 0);
});

test('opisAwarii: nieznany typ → bezpieczny opis domyślny (ton danger)', () => {
  const w = opisAwarii('cokolwiek');
  assert.equal(w.ton, 'danger');
  assert.ok(w.etykieta.length > 0);
});

// ---------------- opisDowodu: etykiety utrwalonych dowodów ----------------

test('opisDowodu: znane typy zdarzeń mają czytelną etykietę', () => {
  assert.equal(opisDowodu('oferta').etykieta, 'Suma kontrolna oferty');
  // Backend zapisuje upload oferty jako 'hash_oferty' — musi dostać tę samą etykietę.
  assert.equal(opisDowodu('hash_oferty').etykieta, 'Suma kontrolna oferty');
  assert.equal(opisDowodu('zrzut').etykieta, 'Zrzut ekranu');
  assert.equal(opisDowodu('awaria').ton, 'danger');
});

test('opisDowodu: nieznany typ nie wywraca listy — ma etykietę i ton', () => {
  const w = opisDowodu('jakis_nowy_typ');
  assert.ok(typeof w.etykieta === 'string' && w.etykieta.length > 0);
  assert.ok(typeof w.ton === 'string');
});

// ---------------- formatZnacznik: czytelny znacznik czasu dowodu ----------------

test('formatZnacznik: ISO ze strefą → data i godzina jak utrwalona (bez konwersji strefy)', () => {
  // Znacznik pokazuje czas ZAPISANY przez serwer (wall-clock z taśmy), nie lokalny.
  assert.equal(formatZnacznik('2026-07-27T14:32:05+02:00'), '27.07.2026 14:32:05');
  assert.equal(formatZnacznik('2026-01-05T08:09+01:00'), '05.01.2026 08:09:00');
});

test('formatZnacznik: brak/śmieci → bezpieczny fallback', () => {
  assert.equal(formatZnacznik(null), 'brak czasu');
  assert.equal(formatZnacznik('xyz'), 'brak czasu');
});
