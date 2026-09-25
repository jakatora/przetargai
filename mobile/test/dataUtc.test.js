import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  naDzienUTC, dodajLata, roznicaDni, dzisiajUTC, odmianaDni, MS_DZIEN,
  przesuniecieStrefyPL, dzisiajPL, koniecDniaPL, chwilaPL,
} from '../src/lib/dataUtc.js';

const MS_GODZINA = 3_600_000;

test('naDzienUTC: string YYYY-MM-DD → północ UTC tego dnia', () => {
  assert.equal(naDzienUTC('2026-05-18'), Date.UTC(2026, 4, 18));
  // strefa czasowa nie przesuwa dnia — bierzemy pierwsze 10 znaków
  assert.equal(naDzienUTC('2026-05-18T23:30:00Z'), Date.UTC(2026, 4, 18));
});

test('naDzienUTC: śmieci i daty niemożliwe → null', () => {
  assert.equal(naDzienUTC('2026-02-30'), null); // 30 lutego nie istnieje
  assert.equal(naDzienUTC('2026-13-01'), null);
  assert.equal(naDzienUTC(''), null);
  assert.equal(naDzienUTC(null), null);
  assert.equal(naDzienUTC(undefined), null);
});

test('dodajLata: zwykły przypadek', () => {
  assert.equal(dodajLata(Date.UTC(2024, 5, 1), 5), Date.UTC(2029, 5, 1));
});

test('dodajLata: 29 lutego w rok nieprzestępny → 28 lutego', () => {
  // 2024-02-29 + 5 lat = 2029 (nieprzestępny) → 2029-02-28
  assert.equal(dodajLata(Date.UTC(2024, 1, 29), 5), Date.UTC(2029, 1, 28));
});

test('roznicaDni: pełne dni między datami', () => {
  assert.equal(roznicaDni(Date.UTC(2026, 0, 15), Date.UTC(2026, 0, 20)), 5);
  assert.equal(roznicaDni(Date.UTC(2026, 0, 20), Date.UTC(2026, 0, 15)), -5);
});

test('dzisiajUTC: obcina chwilę do północy UTC', () => {
  assert.equal(dzisiajUTC(Date.UTC(2026, 0, 15, 13, 45)), Date.UTC(2026, 0, 15));
});

/*
 * Strefa Europe/Warsaw (poprawka 2026-09-25): terminy prawne upływają o 24:00 czasu
 * POLSKIEGO, a „dziś" to dzień kalendarzowy w Polsce. Wszystkie chwile w testach są
 * jawnymi znacznikami UTC — wynik nie zależy od strefy maszyny.
 * 2026: czas letni od ndz 29.03 01:00 UTC do ndz 25.10 01:00 UTC.
 */

test('przesuniecieStrefyPL: zima UTC+1, lato UTC+2', () => {
  assert.equal(przesuniecieStrefyPL(Date.UTC(2026, 0, 15, 12)), MS_GODZINA);
  assert.equal(przesuniecieStrefyPL(Date.UTC(2026, 6, 15, 12)), 2 * MS_GODZINA);
  assert.equal(przesuniecieStrefyPL(Date.UTC(2026, 11, 31, 23)), MS_GODZINA);
});

test('przesuniecieStrefyPL: zmiana czasu w ostatnie niedziele marca i października o 01:00 UTC', () => {
  assert.equal(przesuniecieStrefyPL(Date.UTC(2026, 2, 29, 0, 59, 59)), MS_GODZINA);
  assert.equal(przesuniecieStrefyPL(Date.UTC(2026, 2, 29, 1, 0, 0)), 2 * MS_GODZINA);
  assert.equal(przesuniecieStrefyPL(Date.UTC(2026, 9, 25, 0, 59, 59)), 2 * MS_GODZINA);
  assert.equal(przesuniecieStrefyPL(Date.UTC(2026, 9, 25, 1, 0, 0)), MS_GODZINA);
  // Inny rok (2027: 28.03 i 31.10) — reguła, nie zaszyte daty.
  assert.equal(przesuniecieStrefyPL(Date.UTC(2027, 2, 28, 1, 0, 0)), 2 * MS_GODZINA);
  assert.equal(przesuniecieStrefyPL(Date.UTC(2027, 9, 31, 0, 30, 0)), 2 * MS_GODZINA);
  assert.equal(przesuniecieStrefyPL(Date.UTC(2027, 9, 31, 1, 0, 0)), MS_GODZINA);
});

test('dzisiajPL: po północy czasu polskiego jest już następny dzień (choć w UTC jeszcze nie)', () => {
  // 00:30 CEST 11.06 = 22:30 UTC 10.06
  assert.equal(dzisiajPL(Date.UTC(2026, 5, 10, 22, 30)), Date.UTC(2026, 5, 11));
  assert.equal(dzisiajPL(Date.UTC(2026, 5, 10, 21, 59)), Date.UTC(2026, 5, 10));
  // zima: 00:30 CET 16.01 = 23:30 UTC 15.01
  assert.equal(dzisiajPL(Date.UTC(2026, 0, 15, 23, 30)), Date.UTC(2026, 0, 16));
  assert.equal(dzisiajPL(Date.UTC(2026, 0, 15, 22, 59)), Date.UTC(2026, 0, 15));
});

test('dzisiajUTC (nazwa historyczna) zwraca dzień POLSKI — wołający nie mogą liczyć „dziś" wg UTC', () => {
  assert.equal(dzisiajUTC(Date.UTC(2026, 5, 10, 22, 30)), Date.UTC(2026, 5, 11));
});

test('koniecDniaPL: dzień upływa o 24:00 czasu polskiego (lato 22:00 UTC, zima 23:00 UTC)', () => {
  assert.equal(koniecDniaPL(Date.UTC(2026, 5, 10)), Date.UTC(2026, 5, 10, 22));
  assert.equal(koniecDniaPL(Date.UTC(2026, 0, 15)), Date.UTC(2026, 0, 15, 23));
});

test('koniecDniaPL: dni zmiany czasu', () => {
  // sob 28.03 jeszcze CET → 23:00 UTC; ndz 29.03 już CEST → 22:00 UTC
  assert.equal(koniecDniaPL(Date.UTC(2026, 2, 28)), Date.UTC(2026, 2, 28, 23));
  assert.equal(koniecDniaPL(Date.UTC(2026, 2, 29)), Date.UTC(2026, 2, 29, 22));
  // sob 24.10 jeszcze CEST → 22:00 UTC; ndz 25.10 już CET → 23:00 UTC
  assert.equal(koniecDniaPL(Date.UTC(2026, 9, 24)), Date.UTC(2026, 9, 24, 22));
  assert.equal(koniecDniaPL(Date.UTC(2026, 9, 25)), Date.UTC(2026, 9, 25, 23));
});

test('koniecDniaPL: złe wejście → null', () => {
  assert.equal(koniecDniaPL(null), null);
  assert.equal(koniecDniaPL(Number.NaN), null);
});

test('chwilaPL: godzina „na zegarze" w Polsce → chwila UTC', () => {
  assert.equal(chwilaPL(2026, 7, 1, 15, 0), Date.UTC(2026, 6, 1, 13, 0)); // CEST
  assert.equal(chwilaPL(2026, 1, 20, 15, 0), Date.UTC(2026, 0, 20, 14, 0)); // CET
  assert.equal(chwilaPL(2026, 3, 29, 3, 0), Date.UTC(2026, 2, 29, 1, 0)); // tuż po zmianie na letni
  assert.equal(chwilaPL(2026, 3, 29, 1, 59), Date.UTC(2026, 2, 29, 0, 59)); // tuż przed
});

test('odmianaDni: dokładnie 1 = „dzień", reszta „dni"', () => {
  assert.equal(odmianaDni(1), 'dzień');
  assert.equal(odmianaDni(0), 'dni');
  assert.equal(odmianaDni(5), 'dni');
  assert.equal(odmianaDni(-1), 'dzień');
});

test('MS_DZIEN = doba w ms', () => {
  assert.equal(MS_DZIEN, 86_400_000);
});
