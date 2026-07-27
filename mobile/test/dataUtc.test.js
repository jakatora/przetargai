import { test } from 'node:test';
import assert from 'node:assert/strict';

import { naDzienUTC, dodajLata, roznicaDni, dzisiajUTC, odmianaDni, MS_DZIEN } from '../src/lib/dataUtc.js';

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

test('odmianaDni: dokładnie 1 = „dzień", reszta „dni"', () => {
  assert.equal(odmianaDni(1), 'dzień');
  assert.equal(odmianaDni(0), 'dni');
  assert.equal(odmianaDni(5), 'dni');
  assert.equal(odmianaDni(-1), 'dzień');
});

test('MS_DZIEN = doba w ms', () => {
  assert.equal(MS_DZIEN, 86_400_000);
});
