import { test } from 'node:test';
import assert from 'node:assert/strict';
import { komunikatPrzerwyZrodel } from '../src/lib/stanZrodel.js';

test('BZP cicho puste → komunikat po polsku z nazwą źródła; dwa źródła → liczba mnoga', () => {
  const k = komunikatPrzerwyZrodel({ status: 'ok', cron: { zrodla_cicho_puste: ['bzp'] } });
  assert.equal(k.pokaz, true);
  assert.match(k.tekst, /Biuletyn Zamówień Publicznych/);
  assert.match(k.tekst, /nie opublikował dziś/);
  assert.match(k.tekst, /nie awaria aplikacji/);
  const dwa = komunikatPrzerwyZrodel({ cron: { zrodla_cicho_puste: ['bzp', 'ted'] } }, 'en');
  assert.match(dwa.tekst, /Biuletyn.* and TED/);
  assert.match(komunikatPrzerwyZrodel({ cron: { zrodla_cicho_puste: ['bzp', 'ted'] } }).tekst, /nie opublikowały/);
});

test('brak flagi, stary /health bez pola, null → nie pokazuj, nie rzuca', () => {
  assert.equal(komunikatPrzerwyZrodel({ status: 'ok', cron: { zrodla_cicho_puste: [] } }).pokaz, false);
  assert.equal(komunikatPrzerwyZrodel({ status: 'ok', cron: {} }).pokaz, false);
  assert.equal(komunikatPrzerwyZrodel(null).pokaz, false);
});
