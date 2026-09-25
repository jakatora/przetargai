import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  naDzienUTC, dodajLata, roznicaDni, dzisiajUTC, odmianaDni, MS_DZIEN,
  przesuniecieStrefyPL, dzisiajPL, koniecDniaPL, chwilaPL, chwilaUplywuTerminu,
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

/*
 * Poprawka 2026-09-25: parser przepuszczał `new Date(str)` dla zapisów nie-ISO —
 * „1.06.2026" → styczeń, „10.06.2026" → 5/6 października, „2026-6-10" → dzień wcześniej.
 * Teraz TYLKO `YYYY-MM-DD` (opcjonalnie z częścią czasu ISO) i jawnie parsowany `DD.MM.RRRR`.
 */

test('naDzienUTC: polski zapis DD.MM.RRRR parsowany jawnie (dzień.miesiąc.rok)', () => {
  assert.equal(naDzienUTC('10.06.2026'), Date.UTC(2026, 5, 10));
  assert.equal(naDzienUTC('1.06.2026'), Date.UTC(2026, 5, 1));
  assert.equal(naDzienUTC('01.06.2026'), Date.UTC(2026, 5, 1));
  assert.equal(naDzienUTC('5.1.2026'), Date.UTC(2026, 0, 5));
  assert.equal(naDzienUTC(' 10.06.2026 '), Date.UTC(2026, 5, 10));
});

test('naDzienUTC: polski zapis z nieistniejącym dniem/miesiącem → null', () => {
  assert.equal(naDzienUTC('31.02.2026'), null);
  assert.equal(naDzienUTC('29.02.2026'), null); // 2026 nie jest przestępny
  assert.equal(naDzienUTC('32.01.2026'), null);
  assert.equal(naDzienUTC('10.13.2026'), null);
  assert.equal(naDzienUTC('0.06.2026'), null);
  assert.equal(naDzienUTC('29.02.2028'), Date.UTC(2028, 1, 29)); // przestępny — OK
});

test('naDzienUTC: ISO z częścią czasu — dzień z zapisu daty', () => {
  assert.equal(naDzienUTC('2026-06-10T12:00:00.000Z'), Date.UTC(2026, 5, 10));
  assert.equal(naDzienUTC('2026-06-10T12:00'), Date.UTC(2026, 5, 10));
  assert.equal(naDzienUTC('2026-06-10 12:00:00'), Date.UTC(2026, 5, 10));
  assert.equal(naDzienUTC('2026-06-10T23:30:00+02:00'), Date.UTC(2026, 5, 10));
});

test('naDzienUTC: wszystko poza YYYY-MM-DD i DD.MM.RRRR → null (bez zgadywania przez new Date)', () => {
  for (const zly of [
    '2026-6-10', // bez zer wiodących — new Date dawał dzień wcześniej
    '2026/06/10',
    '10/06/2026',
    '06-10-2026',
    'June 10, 2026',
    '10 czerwca 2026',
    '2026-06-10abc',
    '2026-06-10 jutro',
    '10.06.26',
    '10.06.2026 12:00', // polski zapis tylko jako sama data
    'nie-data',
  ]) {
    assert.equal(naDzienUTC(zly), null, zly);
  }
  assert.equal(naDzienUTC(1781049600000), null); // liczba to nie data kalendarzowa
});

test('naDzienUTC: Date bez zmian (dzień UTC), Invalid Date → null', () => {
  assert.equal(naDzienUTC(new Date(Date.UTC(2026, 5, 10, 12))), Date.UTC(2026, 5, 10));
  assert.equal(naDzienUTC(new Date('x')), null);
});

test('chwilaUplywuTerminu: sama data (ISO lub PL) → 24:00 czasu polskiego', () => {
  assert.deepEqual(chwilaUplywuTerminu('2026-06-10'), { ms: Date.UTC(2026, 5, 10, 22), zGodzina: false });
  assert.deepEqual(chwilaUplywuTerminu('10.06.2026'), { ms: Date.UTC(2026, 5, 10, 22), zGodzina: false });
  assert.deepEqual(chwilaUplywuTerminu('15.01.2026'), { ms: Date.UTC(2026, 0, 15, 23), zGodzina: false });
});

test('chwilaUplywuTerminu: godzina bez strefy = czas polski (niezależnie od strefy telefonu)', () => {
  const oczek = { ms: Date.UTC(2026, 5, 10, 13), zGodzina: true }; // 15:00 CEST
  assert.deepEqual(chwilaUplywuTerminu('2026-06-10T15:00'), oczek);
  assert.deepEqual(chwilaUplywuTerminu('2026-06-10 15:00:00'), oczek);
  assert.deepEqual(chwilaUplywuTerminu('10.06.2026 15:00'), oczek);
  assert.deepEqual(chwilaUplywuTerminu('10.06.2026, 15:00'), oczek);
  assert.deepEqual(chwilaUplywuTerminu('2026-01-20T15:00'), { ms: Date.UTC(2026, 0, 20, 14), zGodzina: true });
});

test('chwilaUplywuTerminu: jawna strefa jest respektowana', () => {
  assert.equal(chwilaUplywuTerminu('2026-06-10T15:00:00Z').ms, Date.UTC(2026, 5, 10, 15));
  assert.equal(chwilaUplywuTerminu('2026-06-10T15:00:00.000Z').ms, Date.UTC(2026, 5, 10, 15));
  assert.equal(chwilaUplywuTerminu('2026-06-10T15:00:00+02:00').ms, Date.UTC(2026, 5, 10, 13));
  assert.equal(chwilaUplywuTerminu('2026-06-10T15:00:00+0200').ms, Date.UTC(2026, 5, 10, 13));
  assert.equal(chwilaUplywuTerminu('2026-06-10T15:00:00-05:00').ms, Date.UTC(2026, 5, 10, 20));
});

test('chwilaUplywuTerminu: Date przyjmujemy jako chwilę', () => {
  const ms = Date.UTC(2026, 5, 10, 8, 15);
  assert.deepEqual(chwilaUplywuTerminu(new Date(ms)), { ms, zGodzina: true });
});

test('chwilaUplywuTerminu: śmieci i niemożliwe godziny → null', () => {
  for (const zly of [
    '', 'nie-data', 'June 10, 2026', '2026-6-10', '2026-06-10T25:00', '2026-06-10T12:61',
    '31.02.2026 10:00', '10.06.2026 24:30', null, undefined, 123, new Date('x'),
  ]) {
    assert.equal(chwilaUplywuTerminu(zly), null, String(zly));
  }
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
