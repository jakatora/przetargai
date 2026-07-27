import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  czasDoTerminu,
  marginesBezpieczenstwa,
  REKOMENDACJA_GODZIN,
  PROG_KRYTYCZNY_GODZIN,
} from '../src/services/czasBezpieczenstwa.js';

/*
 * LICZNIK CZASU BEZPIECZEŃSTWA (podzadanie 6/7 ulepszenia „Czarna skrzynka składania
 * oferty — dowody na awarię platformy"). Czysta logika: ile czasu zostało do terminu
 * składania i ile „czasu bezpieczeństwa" (margines do rekomendowanego złożenia 24 h
 * przed terminem). Aplikacja standardowo namawia na złożenie oferty 24 h wcześniej i
 * pokazuje, ile bezpiecznego zapasu zostało — po terminie czynności nie da się powtórzyć.
 *
 * Testujemy:
 *  1. czasDoTerminu — czas przed terminem (znak, składowe dni/godz/min).
 *  2. czasDoTerminu — po terminie (znak ujemny, poTerminie=true).
 *  3. STREFA CZASOWA — ten sam „ścienny" czas z innym offsetem to inny moment (offset
 *     jest honorowany), a Z i równoważny offset dają ten sam wynik.
 *  4. Progi marginesu: >=24 h => bezpiecznie, w oknie 24 h => ostrzeżenie,
 *     kilka godzin => krytycznie, po terminie => po_terminie.
 *  5. Margines liczy ZAPAS do rekomendowanego złożenia (termin − 24 h) i podaje ten
 *     rekomendowany moment.
 *  6. Determinizm (czas wstrzykiwany), zamrożenie wyniku i walidacja wejścia.
 */

const H = 3600 * 1000;
const MIN = 60 * 1000;

// ══════════════════════════ 1. czasDoTerminu — przed terminem ════════════════

test('czasDoTerminu — czas przed terminem: znak dodatni i rozbicie na składowe', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  const termin = '2026-07-28T12:30:15.000Z'; // +1 dzień, 2 godz, 30 min, 15 s
  const w = czasDoTerminu(termin, teraz);

  assert.equal(w.poTerminie, false);
  assert.equal(w.ms, 26 * H + 30 * MIN + 15 * 1000);
  assert.deepEqual(w.skladowe, { dni: 1, godziny: 2, minuty: 30, sekundy: 15 });
  assert.ok(w.godzinyRazem > 26 && w.godzinyRazem < 27, 'godzinyRazem ~26.5');
});

// ══════════════════════════ 2. czasDoTerminu — po terminie ═══════════════════

test('czasDoTerminu — po terminie: ms ujemne i poTerminie=true', () => {
  const teraz = '2026-07-27T12:05:00.000Z';
  const termin = '2026-07-27T12:00:00.000Z'; // 5 min temu
  const w = czasDoTerminu(termin, teraz);

  assert.equal(w.poTerminie, true);
  assert.equal(w.ms, -5 * MIN);
  // Rozbicie pokazuje wartość bezwzględną (ile temu minął termin).
  assert.deepEqual(w.skladowe, { dni: 0, godziny: 0, minuty: 5, sekundy: 0 });
});

test('czasDoTerminu — dokładnie w terminie liczy się jako po terminie (okno zamknięte)', () => {
  const t = '2026-07-27T12:00:00.000Z';
  const w = czasDoTerminu(t, t);
  assert.equal(w.ms, 0);
  assert.equal(w.poTerminie, true);
});

// ══════════════════════════ 3. STREFA CZASOWA ═══════════════════════════════

test('czasDoTerminu — offset strefy jest honorowany (ten sam czas ścienny, inny moment)', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  // Ten sam zapis ścienny 12:00, ale w strefie +02:00 to 10:00Z — czyli dokładnie „teraz".
  const wZ = czasDoTerminu('2026-07-27T12:00:00.000Z', teraz);
  const wPlus2 = czasDoTerminu('2026-07-27T12:00:00.000+02:00', teraz);

  assert.equal(wZ.ms, 2 * H, 'termin w UTC: 2 h do przodu');
  assert.equal(wPlus2.ms, 0, 'termin 12:00+02:00 == 10:00Z == teraz');
  assert.notEqual(wZ.ms, wPlus2.ms, 'offset zmienia moment');
});

test('czasDoTerminu — Z i równoważny offset dają identyczny wynik', () => {
  const teraz = '2026-07-27T08:00:00.000Z';
  const a = czasDoTerminu('2026-07-27T12:00:00.000Z', teraz);
  const b = czasDoTerminu('2026-07-27T14:00:00.000+02:00', teraz); // == 12:00Z
  assert.equal(a.ms, b.ms);
});

// ══════════════════════════ 4. PROGI MARGINESU BEZPIECZEŃSTWA ════════════════

test('marginesBezpieczenstwa — co najmniej 24 h zapasu => bezpiecznie', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  // Dokładnie 24 h do terminu — wciąż zdążysz na rekomendowany moment.
  const w = marginesBezpieczenstwa('2026-07-28T10:00:00.000Z', teraz);
  assert.equal(w.status, 'bezpiecznie');
  assert.equal(w.poTerminie, false);
});

test('marginesBezpieczenstwa — w oknie 24 h (ale > kilka godzin) => ostrzeżenie', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  const w = marginesBezpieczenstwa('2026-07-28T04:00:00.000Z', teraz); // 18 h
  assert.equal(w.status, 'ostrzezenie');
  assert.equal(w.poTerminie, false);
});

test('marginesBezpieczenstwa — kilka godzin do terminu => krytycznie', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  const w = marginesBezpieczenstwa('2026-07-27T12:00:00.000Z', teraz); // 2 h
  assert.equal(w.status, 'krytycznie');
  assert.equal(w.poTerminie, false);
});

test('marginesBezpieczenstwa — po terminie => po_terminie', () => {
  const teraz = '2026-07-27T12:30:00.000Z';
  const w = marginesBezpieczenstwa('2026-07-27T12:00:00.000Z', teraz);
  assert.equal(w.status, 'po_terminie');
  assert.equal(w.poTerminie, true);
});

test('marginesBezpieczenstwa — próg krytyczny to granica ostra (dokładnie próg => ostrzeżenie)', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  const terminNaProgu = new Date(Date.parse(teraz) + PROG_KRYTYCZNY_GODZIN * H).toISOString();
  const w = marginesBezpieczenstwa(terminNaProgu, teraz);
  assert.equal(w.status, 'ostrzezenie', 'dokładnie na progu jeszcze nie krytycznie');
});

// ══════════════════════════ 5. ZAPAS DO REKOMENDOWANEGO ZŁOŻENIA ═════════════

test('marginesBezpieczenstwa — liczy zapas do rekomendowanego złożenia (termin − 24 h)', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  const termin = '2026-07-29T10:00:00.000Z'; // 48 h do terminu
  const w = marginesBezpieczenstwa(termin, teraz);

  // Rekomendacja: złóż 24 h przed terminem => 2026-07-28T10:00Z; zapasu jeszcze 24 h.
  assert.equal(w.terminRekomendowany, '2026-07-28T10:00:00.000Z');
  assert.equal(w.zapasDoRekomendacjiMs, 24 * H);
  assert.equal(w.rekomendacjaGodzin, 24);
});

test('marginesBezpieczenstwa — po przekroczeniu rekomendacji zapas jest ujemny', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  const termin = '2026-07-27T20:00:00.000Z'; // 10 h do terminu, rekomendacja już minęła
  const w = marginesBezpieczenstwa(termin, teraz);
  assert.ok(w.zapasDoRekomendacjiMs < 0, 'zapas ujemny — jesteś po rekomendowanym momencie');
  assert.equal(w.poTerminie, false, 'ale wciąż przed właściwym terminem');
});

// ══════════════════════════ 6. DETERMINIZM / ZAMROŻENIE / WALIDACJA ══════════

test('stałe progu są wyeksponowane (24 h rekomendacja, kilka godzin próg krytyczny)', () => {
  assert.equal(REKOMENDACJA_GODZIN, 24);
  assert.ok(PROG_KRYTYCZNY_GODZIN > 0 && PROG_KRYTYCZNY_GODZIN < REKOMENDACJA_GODZIN);
});

test('marginesBezpieczenstwa — wynik jest deterministyczny i zamrożony', () => {
  const teraz = '2026-07-27T10:00:00.000Z';
  const termin = '2026-07-28T12:00:00.000Z';
  const a = marginesBezpieczenstwa(termin, teraz);
  const b = marginesBezpieczenstwa(termin, teraz);
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.czas));
});

test('akceptuje Date i epoch ms tak samo jak ISO string', () => {
  const terazMs = Date.parse('2026-07-27T10:00:00.000Z');
  const terminMs = Date.parse('2026-07-27T13:00:00.000Z');
  const zIso = czasDoTerminu('2026-07-27T13:00:00.000Z', '2026-07-27T10:00:00.000Z');
  const zDate = czasDoTerminu(new Date(terminMs), new Date(terazMs));
  const zEpoch = czasDoTerminu(terminMs, terazMs);
  assert.equal(zIso.ms, 3 * H);
  assert.equal(zDate.ms, 3 * H);
  assert.equal(zEpoch.ms, 3 * H);
});

test('walidacja wejścia — niepoprawna data rzuca TypeError', () => {
  assert.throws(() => czasDoTerminu('nie-data', '2026-07-27T10:00:00.000Z'), /termin|data/i);
  assert.throws(() => czasDoTerminu('2026-07-27T10:00:00.000Z', 'nie-data'), /teraz|data/i);
  assert.throws(() => marginesBezpieczenstwa('nie-data', '2026-07-27T10:00:00.000Z'), /termin|data/i);
});
