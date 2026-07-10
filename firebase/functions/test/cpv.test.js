import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCpvCodes, cpvAffinity, cpvDivisions } from '../src/lib/cpv.js';

/*
 * BZP zwraca `cpvCode` jako sklejony łańcuch wielu kodów z opisami:
 *   "45000000-7 (Roboty budowlane),45233200-1 (Roboty w zakresie różnych nawierzchni)"
 * Stary `scoring.js` robił replace(/\D/g,'') na całości i porównywał prefiks
 * tylko z początkiem sklejonego ciągu — czyli widział wyłącznie pierwszy kod.
 */

// ---------------------------- parseCpvCodes ----------------------------

test('parseCpvCodes — rozbija sklejony łańcuch BZP na wszystkie kody', () => {
  const raw = '45000000-7 (Roboty budowlane),45233200-1 (Roboty w zakresie różnych nawierzchni),45233222-1 (Roboty w zakresie układania chodników i asfaltowania)';
  assert.deepEqual(parseCpvCodes(raw), ['45000000', '45233200', '45233222']);
});

test('parseCpvCodes — obcina cyfrę kontrolną po myślniku', () => {
  assert.deepEqual(parseCpvCodes('45233222-1'), ['45233222']);
});

test('parseCpvCodes — przyjmuje goły kod bez opisu i bez cyfry kontrolnej', () => {
  assert.deepEqual(parseCpvCodes('45000000'), ['45000000']);
});

test('parseCpvCodes — przyjmuje tablicę kodów (profil firmy)', () => {
  assert.deepEqual(parseCpvCodes(['45000000', '45233000-9']), ['45000000', '45233000']);
});

test('parseCpvCodes — pusty wejściowy daje pustą tablicę', () => {
  assert.deepEqual(parseCpvCodes(null), []);
  assert.deepEqual(parseCpvCodes(''), []);
  assert.deepEqual(parseCpvCodes(undefined), []);
});

test('parseCpvCodes — usuwa duplikaty zachowując kolejność', () => {
  assert.deepEqual(parseCpvCodes('45000000-7,45000000-7,45233200-1'), ['45000000', '45233200']);
});

test('parseCpvCodes — pomija śmieci, które nie są 8-cyfrowym kodem', () => {
  assert.deepEqual(parseCpvCodes('brak danych, 4523, 45233222-1'), ['45233222']);
});

// ---------------------------- cpvAffinity ----------------------------
/*
 * Zera końcowe w kodzie firmy niosą sens — wyznaczają SZEROKOŚĆ zainteresowania:
 *   45000000 → "45"       cała budowlanka
 *   45300000 → "453"      instalacje budowlane
 *   45233000 → "45233"    roboty drogowe
 *   45233222 → "45233222" dokładnie chodniki
 * Przetarg pasuje, gdy jego kod ZACZYNA SIĘ od tego prefiksu. Im dłuższy prefiks,
 * tym węższa deklaracja firmy i tym pewniejsze dopasowanie.
 */

test('cpvAffinity — identyczny kod daje 1.0', () => {
  assert.equal(cpvAffinity(['45233222'], ['45233222']), 1);
});

test('cpvAffinity — prefiks 5+ cyfr daje 0.8', () => {
  // firma: 45233000 → "45233" (roboty drogowe); przetarg 45233120 (budowa dróg)
  assert.equal(cpvAffinity(['45233000'], ['45233120']), 0.8);
});

test('cpvAffinity — prefiks 3–4 cyfr daje 0.6', () => {
  // firma: 45300000 → "453" (instalacje); przetarg 45311000 (instalacje elektryczne)
  assert.equal(cpvAffinity(['45300000'], ['45311000']), 0.6);
});

test('cpvAffinity — prefiks 2 cyfr (cały dział) daje 0.35', () => {
  // firma: 45000000 → "45" (dowolna budowlanka); przetarg 45233120
  assert.equal(cpvAffinity(['45000000'], ['45233120']), 0.35);
});

test('cpvAffinity — węższa deklaracja firmy nie łapie sąsiedniej kategorii', () => {
  // firma: 45300000 → "453"; przetarg 45233140 zaczyna się od "452" — nie pasuje.
  // To jest kontrakt, którego pilnuje scoring.test.js: „niezgodny CPV nie daje premii”.
  assert.equal(cpvAffinity(['45300000'], ['45233140']), 0);
});

test('cpvAffinity — inny dział daje 0', () => {
  // 45 (budowlanka) vs 55 (usługi gastronomiczne)
  assert.equal(cpvAffinity(['45233000'], ['55321000']), 0);
});

test('REGRESJA P-1: kod na dalszej pozycji listy jest widziany', () => {
  // Realny przetarg z BZP: 45233222 (chodniki) stoi na TRZECIEJ pozycji.
  // Stary scoring widział wyłącznie 45000000 i dawał firmie 45233000 wynik zero.
  const przetarg = parseCpvCodes(
    '45000000-7 (Roboty budowlane),45233200-1 (Roboty w zakresie różnych nawierzchni),45233222-1 (Roboty w zakresie układania chodników i asfaltowania)',
  );
  assert.equal(cpvAffinity(['45233000'], przetarg), 0.8);
});

test('cpvAffinity — bierze najlepszą parę, nie pierwszą', () => {
  // Pierwsza para daje 0.35, druga 1.0 — wynik ma być 1.0.
  assert.equal(cpvAffinity(['45000000', '45233222'], ['45233222']), 1);
});

test('cpvAffinity — pusty profil lub pusty przetarg daje 0', () => {
  assert.equal(cpvAffinity([], ['45233222']), 0);
  assert.equal(cpvAffinity(['45233222'], []), 0);
});

// ---------------------------- cpvDivisions ----------------------------

test('cpvDivisions — zwraca unikalne dwucyfrowe działy', () => {
  assert.deepEqual(cpvDivisions(['45233222', '45000000', '90910000']), ['45', '90']);
});
