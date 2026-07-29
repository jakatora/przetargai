import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obliczTermin } from '../src/lib/kalkulatorTerminow.js';
import { oblicz_termin_kio, czyDzienWolny, naDzienUTC } from '../src/lib/terminKio.js';

/*
 * Kalkulator terminów Pzp. Silnik dni wolnych współdzielony z terminKio.js, więc
 * kluczowy test to ZGODNOŚĆ trybu kalendarzowego z oblicz_termin_kio (to samo prawo:
 * art. 111 § 2 + 115 KC). Reszta: jawne przypadki wokół Wielkanocy 2026 (ruchome święta),
 * dni robocze i walidacja wejścia.
 *
 * Wielkanoc 2026 = niedziela 5 kwietnia; Poniedziałek Wielkanocny = 6 kwietnia (wolne).
 */

// ---- zgodność z silnikiem KIO (kalendarzowe = to samo prawo) ----
test('kalendarzowe = oblicz_termin_kio dla tych samych dni (jedno źródło prawa)', () => {
  const daty = ['2026-01-15', '2026-04-01', '2026-07-15', '2026-12-20', '2026-05-01'];
  for (const d of daty) {
    assert.equal(obliczTermin({ dataZdarzenia: d, dni: 5, tryb: 'kalendarzowe' }).data,
      oblicz_termin_kio(d, 'krajowy'), `5 dni od ${d}`);
    assert.equal(obliczTermin({ dataZdarzenia: d, dni: 10, tryb: 'kalendarzowe' }).data,
      oblicz_termin_kio(d, 'unijny'), `10 dni od ${d}`);
    assert.equal(obliczTermin({ dataZdarzenia: d, dni: 15, tryb: 'kalendarzowe' }).data,
      oblicz_termin_kio(d, 'unijny_pisemny'), `15 dni od ${d}`);
  }
});

// ---- ruchome święta (Wielkanoc 2026) ----
test('kalendarzowe: koniec w Poniedziałek Wielkanocny → przesunięcie o 1 dzień roboczy', () => {
  // 2026-04-01 + 5 dni = 2026-04-06 (Poniedziałek Wielkanocny, wolne) → 2026-04-07 (wtorek).
  const w = obliczTermin({ dataZdarzenia: '2026-04-01', dni: 5, tryb: 'kalendarzowe' });
  assert.equal(w.data, '2026-04-07');
  assert.equal(w.dataSurowa, '2026-04-06');
  assert.equal(w.przesuniety, true);
  assert.equal(w.dniPrzesuniecia, 1);
  assert.equal(w.dzienTygodnia, 'wtorek');
});

test('kalendarzowe: koniec w niedzielę wielkanocną → przeskok przez 2 dni wolne', () => {
  // 2026-04-01 + 4 dni = 2026-04-05 (Wielkanoc, niedziela) → 04-06 (Pn Wlk, wolne) → 04-07.
  const w = obliczTermin({ dataZdarzenia: '2026-04-01', dni: 4, tryb: 'kalendarzowe' });
  assert.equal(w.data, '2026-04-07');
  assert.equal(w.dniPrzesuniecia, 2);
});

// ---- dni robocze ----
test('robocze: 1 dzień roboczy przez długi weekend + święto', () => {
  // 2026-04-03 (piątek) + 1 dzień roboczy: 04-04 sob, 04-05 nd, 04-06 Pn Wlk (wolne) → 04-07 wt.
  const w = obliczTermin({ dataZdarzenia: '2026-04-03', dni: 1, tryb: 'robocze' });
  assert.equal(w.data, '2026-04-07');
  assert.equal(w.dniWolnePominiete, 3);
  assert.equal(w.dzienTygodnia, 'wtorek');
});

test('robocze: wynik jest ZAWSZE dniem roboczym; robocze ≥ kalendarzowe', () => {
  const daty = ['2026-01-15', '2026-04-01', '2026-11-05', '2026-12-18'];
  for (const d of daty) {
    for (const n of [1, 3, 7, 14]) {
      const rob = obliczTermin({ dataZdarzenia: d, dni: n, tryb: 'robocze' });
      assert.equal(czyDzienWolny(naDzienUTC(rob.data)), false, `robocze(${d},${n}) musi być dniem roboczym`);
      const kal = obliczTermin({ dataZdarzenia: d, dni: n, tryb: 'kalendarzowe' });
      assert.ok(rob.data >= kal.data, `robocze(${n}) nie może wypaść wcześniej niż kalendarzowe`);
    }
  }
});

test('kalendarzowe: wynik NIGDY nie wypada w dzień wolny (art. 115 KC)', () => {
  for (const d of ['2026-01-01', '2026-05-01', '2026-12-24', '2026-08-14', '2026-11-10']) {
    for (const n of [1, 2, 5, 30]) {
      const w = obliczTermin({ dataZdarzenia: d, dni: n, tryb: 'kalendarzowe' });
      assert.equal(czyDzienWolny(naDzienUTC(w.data)), false, `${d}+${n} musi kończyć się w dzień roboczy`);
    }
  }
});

// ---- walidacja ----
test('błędne wejście: brak/niepoprawna data → ok:false brak_daty', () => {
  assert.equal(obliczTermin({ dataZdarzenia: '', dni: 5 }).powod, 'brak_daty');
  assert.equal(obliczTermin({ dataZdarzenia: 'kiedyś', dni: 5 }).powod, 'brak_daty');
  assert.equal(obliczTermin({ dataZdarzenia: '2026-02-30', dni: 5 }).powod, 'brak_daty');
});

test('błędne wejście: zła liczba dni → ok:false zla_liczba', () => {
  for (const dni of [0, -3, 2.5, 'abc', null, undefined]) {
    assert.equal(obliczTermin({ dataZdarzenia: '2026-05-10', dni }).powod, 'zla_liczba', `dni=${dni}`);
  }
});
