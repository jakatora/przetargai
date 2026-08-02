import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dzialCpv, orientacyjnaWartosc } from '../src/lib/wartosciBenchmark.js';
import { BENCHMARK_WARTOSCI } from '../src/lib/wartosciBenchmarkDane.js';

test('dzialCpv: bierze 2 pierwsze cyfry kodu CPV', () => {
  assert.equal(dzialCpv('45233120-0'), '45');
  assert.equal(dzialCpv('33112200'), '33');
  assert.equal(dzialCpv('09000000-3'), '09');
  assert.equal(dzialCpv(null), null);
  assert.equal(dzialCpv('brak'), null);
});

test('dane benchmarku: rozsądny rozmiar i struktura [p25,med,p75,n]', () => {
  const dzialy = Object.keys(BENCHMARK_WARTOSCI);
  assert.ok(dzialy.length >= 30, `spodziewano ≥30 działów CPV, jest ${dzialy.length}`);
  const b45 = BENCHMARK_WARTOSCI['45'];
  assert.ok(b45 && Array.isArray(b45.k) && b45.k.length === 4);
  const [p25, med, p75, n] = b45.k;
  assert.ok(p25 < med && med < p75, 'kwartyle rosnące');
  assert.ok(n > 100, 'sensowna liczba rekordów');
});

test('orientacyjnaWartosc: roboty budowlane (45) — poziom krajowy gdy brak woj.', () => {
  const w = orientacyjnaWartosc('45000000-7', null);
  assert.ok(w);
  assert.equal(w.poziom, 'kraj');
  assert.ok(w.p25 < w.mediana && w.mediana < w.p75);
});

test('orientacyjnaWartosc: preferuje dane regionalne, gdy istnieją', () => {
  // 45 (roboty budowlane) ma dane wojewódzkie; PL14 = mazowieckie.
  const woj = orientacyjnaWartosc('45233120', 'PL14');
  assert.ok(woj);
  assert.equal(woj.poziom, 'wojewodztwo');
  // Normalizacja województwa działa też dla samego kodu „14".
  assert.equal(orientacyjnaWartosc('45233120', '14').poziom, 'wojewodztwo');
});

test('orientacyjnaWartosc: nieznany dział CPV → null', () => {
  assert.equal(orientacyjnaWartosc('99999999', 'PL14'), null);
  assert.equal(orientacyjnaWartosc(null, 'PL14'), null);
});

test('orientacyjnaWartosc: nieznane województwo spada do poziomu krajowego', () => {
  const w = orientacyjnaWartosc('45000000', 'PLXX');
  assert.ok(w);
  assert.equal(w.poziom, 'kraj');
});
