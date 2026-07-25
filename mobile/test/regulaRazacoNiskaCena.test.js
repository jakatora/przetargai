import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  regula_razaco_niska_cena,
  SILA_ZARZUTU,
  PROG_RAZACO_NISKA_CENY,
} from '../src/lib/regulaRazacoNiskaCena.js';

/*
 * Reguła rażąco niskiej ceny (podzadanie 9/13 ulepszenia „Prześwietlenie oferty
 * zwycięzcy i szansa na odwołanie"). Czysta funkcja: wykrywa przesłankę odrzucenia
 * z art. 224 ust. 2 pkt 1 Pzp — cena zwycięzcy niższa O CO NAJMNIEJ 30% od średniej
 * arytmetycznej cen złożonych ofert. Zwraca { wykryto, opis_zarzutu, sila }.
 *
 * Kotwice liczbowe dobrane tak, by średnia = 100 000 (suma ofert = 300 000 / 3),
 * więc procent „poniżej średniej" czyta się wprost z ceny zwycięzcy.
 */

// --- Kontrakt eksportowany (skala siły + próg) ---

test('SILA_ZARZUTU: skala od najsłabszej do najmocniejszej', () => {
  assert.deepEqual(SILA_ZARZUTU, ['slaba', 'umiarkowana', 'mocna']);
});

test('PROG_RAZACO_NISKA_CENY: ustawowe 30% (art. 224 ust. 2 pkt 1 Pzp)', () => {
  assert.equal(PROG_RAZACO_NISKA_CENY, 0.3);
});

// --- Wykrycie i siła zarzutu ---

test('wykrywa, gdy cena o ~35% poniżej średniej — siła umiarkowana', () => {
  const wynik = regula_razaco_niska_cena(65000, [65000, 120000, 115000]);
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'umiarkowana');
  assert.match(wynik.opis_zarzutu, /art\. 224 ust\. 2 pkt 1/);
  assert.match(wynik.opis_zarzutu, /35%/);
});

test('wykrywa mocno, gdy cena o 70% poniżej średniej — siła mocna', () => {
  const wynik = regula_razaco_niska_cena(30000, [30000, 130000, 140000]);
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'mocna');
});

test('granica 30% (cena = 0,7 średniej) wpada w zarzut (o co najmniej 30%)', () => {
  const wynik = regula_razaco_niska_cena(70000, [70000, 110000, 120000]);
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'umiarkowana');
});

test('granica 50% (cena = 0,5 średniej) to już siła mocna', () => {
  const wynik = regula_razaco_niska_cena(50000, [50000, 130000, 120000]);
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'mocna');
});

test('tuż pod progiem (25% poniżej) — brak zarzutu', () => {
  const wynik = regula_razaco_niska_cena(75000, [75000, 110000, 115000]);
  assert.deepEqual(wynik, { wykryto: false, opis_zarzutu: null, sila: null });
});

test('cena zbliżona do średniej (10% poniżej) — brak zarzutu', () => {
  const wynik = regula_razaco_niska_cena(90000, [90000, 105000, 105000]);
  assert.equal(wynik.wykryto, false);
  assert.equal(wynik.opis_zarzutu, null);
  assert.equal(wynik.sila, null);
});

test('cena powyżej średniej — brak zarzutu', () => {
  const wynik = regula_razaco_niska_cena(130000, [130000, 90000, 80000]);
  assert.equal(wynik.wykryto, false);
});

// --- Akceptacja kształtu { kwota } z parsera wyodrebnij_pola_z_oferty ---

test('akceptuje cenę i oferty jako obiekty { kwota } (kształt parsera oferty)', () => {
  const cena = { kwota: 40000, waluta: 'PLN', surowa: '40 000 zł' };
  const oferty = [{ kwota: 40000 }, { kwota: 130000 }, { kwota: 130000 }];
  const wynik = regula_razaco_niska_cena(cena, oferty);
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'mocna'); // 40000 vs średnia 100000 → 60% poniżej
});

// --- Odporność (nigdy nie rzuca, pełny kształt przy braku danych) ---

test('pomija nieprawidłowe wpisy ofert przy liczeniu średniej', () => {
  // Poprawne oferty: 70000, 110000, 120000 (średnia 100000); śmieci ignorowane.
  const oferty = [70000, null, 'abc', 0, -5, { kwota: 110000 }, { kwota: NaN }, 120000];
  const wynik = regula_razaco_niska_cena(70000, oferty);
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'umiarkowana');
});

test('brak ofert (pusta tablica) — brak danych, nie rzuca', () => {
  const wynik = regula_razaco_niska_cena(50000, []);
  assert.deepEqual(wynik, { wykryto: false, opis_zarzutu: null, sila: null });
});

test('oferty nie są tablicą — brak danych, nie rzuca', () => {
  assert.deepEqual(regula_razaco_niska_cena(50000, null), {
    wykryto: false,
    opis_zarzutu: null,
    sila: null,
  });
  assert.deepEqual(regula_razaco_niska_cena(50000, undefined), {
    wykryto: false,
    opis_zarzutu: null,
    sila: null,
  });
});

test('cena zwycięzcy nieprawidłowa (null/0/ujemna/NaN) — brak zarzutu, nie rzuca', () => {
  for (const zla of [null, undefined, 0, -100, NaN, 'tanio', {}]) {
    const wynik = regula_razaco_niska_cena(zla, [90000, 100000, 110000]);
    assert.deepEqual(wynik, { wykryto: false, opis_zarzutu: null, sila: null });
  }
});

test('tylko jedna oferta równa cenie zwycięzcy — 0% poniżej, brak zarzutu', () => {
  const wynik = regula_razaco_niska_cena(50000, [50000]);
  assert.equal(wynik.wykryto, false);
});

test('opis zarzutu niesie obie kwoty i podstawę wezwania do wyjaśnień', () => {
  const wynik = regula_razaco_niska_cena(60000, [60000, 130000, 110000]);
  assert.match(wynik.opis_zarzutu, /60 000 PLN/); // cena zwycięzcy
  assert.match(wynik.opis_zarzutu, /100 000 PLN/); // średnia
  assert.match(wynik.opis_zarzutu, /wyjaśnie/i); // obowiązek wezwania do wyjaśnień
});

test('nie rzuca przy zupełnie pustym wywołaniu', () => {
  assert.doesNotThrow(() => regula_razaco_niska_cena());
  assert.deepEqual(regula_razaco_niska_cena(), { wykryto: false, opis_zarzutu: null, sila: null });
});
