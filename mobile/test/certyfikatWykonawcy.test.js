import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analizaCertyfikatu, walidujCertyfikat } from '../src/lib/certyfikatWykonawcy.js';

test('analizaCertyfikatu: częsty wystawca → opłaca się, liczy oszczędność i break-even', () => {
  const w = analizaCertyfikatu({
    startowRocznie: 20,
    godzinNaStart: 8,
    stawkaGodzinowa: 100,
    kosztCertyfikatuRocznie: 3000,
    // godzinNaStartZCertyfikatem domyślnie 20% z 8 = 1.6
  });
  assert.equal(w.kosztObecny, 16000);       // 20 × 8 × 100
  assert.equal(w.kosztZCertyfikatem, 6200); // 20 × 1.6 × 100 + 3000
  assert.equal(w.oszczednosc, 9800);
  assert.equal(w.oplacaSie, true);
  assert.equal(w.ton, 'sukces');
  assert.equal(w.progStartow, 5);           // ceil(3000 / ((8−1.6)×100))
});

test('analizaCertyfikatu: rzadki wystawca → nie opłaca się (neutral)', () => {
  const w = analizaCertyfikatu({
    startowRocznie: 2, godzinNaStart: 8, stawkaGodzinowa: 100, kosztCertyfikatuRocznie: 3000,
  });
  assert.equal(w.oplacaSie, false);
  assert.equal(w.ton, 'neutral');
  assert.ok(w.oszczednosc < 0);
});

test('analizaCertyfikatu: pełna kontrola czasu z certyfikatem (jawny parametr)', () => {
  const w = analizaCertyfikatu({
    startowRocznie: 10, godzinNaStart: 6, stawkaGodzinowa: 80,
    kosztCertyfikatuRocznie: 1000, godzinNaStartZCertyfikatem: 1,
  });
  assert.equal(w.godzinyObecnie, 60);
  assert.equal(w.godzinyZCertyfikatem, 10);
  assert.equal(w.kosztObecny, 4800);        // 60 × 80
  assert.equal(w.kosztZCertyfikatem, 1800); // 10 × 80 + 1000
  assert.equal(w.oszczednosc, 3000);
});

test('analizaCertyfikatu: same zera nie wywalają, break-even null', () => {
  const w = analizaCertyfikatu({});
  assert.equal(w.kosztObecny, 0);
  assert.equal(w.oplacaSie, false);
  assert.equal(w.progStartow, null);
});

test('walidujCertyfikat: puste pola → brak błędów (stan pusty, nie błąd)', () => {
  const w = walidujCertyfikat({ startowRocznie: '', godzinNaStart: '  ', stawkaGodzinowa: '', kosztCertyfikatuRocznie: undefined });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujCertyfikat: poprawne liczby (też „3 000,50") → brak błędów', () => {
  const w = walidujCertyfikat({ startowRocznie: '20', godzinNaStart: '7,5', stawkaGodzinowa: '100', kosztCertyfikatuRocznie: '3 000,50' });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujCertyfikat: „1.200,50" w stawce i koszcie → komunikat zamiast cichego 0', () => {
  const w = walidujCertyfikat({ stawkaGodzinowa: '1.200,50', kosztCertyfikatuRocznie: '1.200,50' });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.stawkaGodzinowa, 'Podaj kwotę jako liczbę, np. 1200,00');
  assert.equal(w.bledy.kosztCertyfikatuRocznie, 'Podaj kwotę jako liczbę, np. 1200,00');
});

test('walidujCertyfikat: przetargi rocznie — liczba całkowita w zakresie 0–1000', () => {
  assert.equal(walidujCertyfikat({ startowRocznie: '2,5' }).bledy.startowRocznie, 'Podaj liczbę całkowitą');
  assert.equal(walidujCertyfikat({ startowRocznie: '5000' }).bledy.startowRocznie, 'Wartość nie może przekraczać 1000');
});

test('walidujCertyfikat: godziny na start w zakresie 0–200', () => {
  assert.equal(walidujCertyfikat({ godzinNaStart: '500' }).bledy.godzinNaStart, 'Wartość nie może przekraczać 200');
  assert.equal(walidujCertyfikat({ godzinNaStart: '-1' }).bledy.godzinNaStart, 'Wartość musi wynosić co najmniej 0');
});

test('walidujCertyfikat: bez argumentów nie wywraca funkcji', () => {
  const w = walidujCertyfikat();
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});
