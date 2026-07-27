import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Logika ALARMU waloryzacji `ocenAlarmWaloryzacji` / `wzrostCenProc` — podzadanie
 * 11/12 ulepszenia „pilnowanie waloryzacji i pułapek w umowie". Czyste funkcje,
 * testy jednostkowe bez sieci i bazy. Sprawdzamy zarówno „szczęśliwą ścieżkę"
 * (wzrost ponad próg => alarm), jak i ADWERSARYJNIE granice: dokładnie na progu
 * (nie alarm), szum float, brak danych, brak progu, spadek cen.
 */

const { ocenAlarmWaloryzacji, wzrostCenProc } = await import('../src/lib/waloryzacjaAlarm.js');

// ── wzrostCenProc ────────────────────────────────────────────────────────────

test('wzrostCenProc: 100 -> 110 to +10%', () => {
  assert.equal(wzrostCenProc(100, 110), 10);
});

test('wzrostCenProc: spadek cen daje wartość ujemną', () => {
  assert.equal(wzrostCenProc(100, 95), -5);
});

test('wzrostCenProc: zaokrągla do 2 miejsc', () => {
  // 112.4 -> 125.9 => 12.0106...% => 12.01
  assert.equal(wzrostCenProc(112.4, 125.9), 12.01);
});

test('wzrostCenProc: baza/aktualny niedodatnie lub nie-liczby => null (brak danych, nie 0%)', () => {
  assert.equal(wzrostCenProc(0, 110), null);
  assert.equal(wzrostCenProc(-1, 110), null);
  assert.equal(wzrostCenProc(100, 0), null);
  assert.equal(wzrostCenProc(100, -1), null);
  assert.equal(wzrostCenProc(NaN, 110), null);
  assert.equal(wzrostCenProc(100, Infinity), null);
  assert.equal(wzrostCenProc('100', 110), null);
});

// ── ocenAlarmWaloryzacji: przekroczenie progu ────────────────────────────────

test('alarm: wzrost PONAD próg => przekroczony', () => {
  const r = ocenAlarmWaloryzacji({ wskaznikBazowy: 100, wskaznikAktualny: 110.5, prog: 10 });
  assert.equal(r.przekroczony, true);
  assert.equal(r.wzrost, 10.5);
  assert.equal(r.prog, 10);
  assert.match(r.powod, /przekroczy/);
});

test('alarm: wzrost DOKŁADNIE na progu => NIE przekroczony ("o ponad X%")', () => {
  const r = ocenAlarmWaloryzacji({ wskaznikBazowy: 100, wskaznikAktualny: 110, prog: 10 });
  assert.equal(r.przekroczony, false);
  assert.equal(r.wzrost, 10);
});

test('alarm: wzrost PONIŻEJ progu => NIE przekroczony, ale wzrost policzony', () => {
  const r = ocenAlarmWaloryzacji({ wskaznikBazowy: 100, wskaznikAktualny: 105, prog: 10 });
  assert.equal(r.przekroczony, false);
  assert.equal(r.wzrost, 5);
  assert.equal(r.prog, 10);
});

test('alarm: decyzja liczona na ZAOKRĄGLONYM wzroście (spójna z tym, co widzi user)', () => {
  // 110.004% -> 10.00 po zaokrągleniu => nie przekracza progu 10.
  assert.equal(ocenAlarmWaloryzacji({ wskaznikBazowy: 100, wskaznikAktualny: 110.004, prog: 10 }).przekroczony, false);
  // 110.006% -> 10.01 po zaokrągleniu => przekracza próg 10.
  assert.equal(ocenAlarmWaloryzacji({ wskaznikBazowy: 100, wskaznikAktualny: 110.006, prog: 10 }).przekroczony, true);
});

// ── ocenAlarmWaloryzacji: konserwatywne „nie alarmuj" ────────────────────────

test('alarm: brak danych o wskaźnikach => brak alarmu, wzrost null', () => {
  const r = ocenAlarmWaloryzacji({ wskaznikBazowy: 0, wskaznikAktualny: 110, prog: 10 });
  assert.equal(r.przekroczony, false);
  assert.equal(r.wzrost, null);
});

test('alarm: brak/niepoprawny próg => brak alarmu, ale wzrost nadal policzony', () => {
  for (const prog of [null, undefined, 0, -5, NaN, '10']) {
    const r = ocenAlarmWaloryzacji({ wskaznikBazowy: 100, wskaznikAktualny: 130, prog });
    assert.equal(r.przekroczony, false, `prog=${prog} nie może dać alarmu`);
    assert.equal(r.wzrost, 30, 'wzrost liczymy niezależnie od progu');
    assert.equal(r.prog, null);
  }
});

test('alarm: spadek cen poniżej bazy nigdy nie alarmuje', () => {
  const r = ocenAlarmWaloryzacji({ wskaznikBazowy: 120, wskaznikAktualny: 110, prog: 5 });
  assert.equal(r.przekroczony, false);
  assert.ok(r.wzrost < 0);
});

test('alarm: wywołanie bez argumentu nie wybucha (defensywnie => brak alarmu)', () => {
  const r = ocenAlarmWaloryzacji();
  assert.equal(r.przekroczony, false);
  assert.equal(r.wzrost, null);
});
