import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ETYKIETY_WERDYKTU, ETYKIETY_STATUSU, opisPowodu } from '../src/lib/warunkiUdzialu.js';

test('werdykty i statusy mają etykiety PL/EN i ton', () => {
  for (const w of ['spelniasz', 'nie_spelniasz', 'sprawdz']) {
    assert.ok(ETYKIETY_WERDYKTU[w].etykieta.pl && ETYKIETY_WERDYKTU[w].etykieta.en && ETYKIETY_WERDYKTU[w].ton, w);
  }
  for (const s of ['ok', 'brak', 'nie_wiem']) assert.ok(ETYKIETY_STATUSU[s].znak && ETYKIETY_STATUSU[s].etykieta.pl, s);
});

test('każdy powód z API ma zdanie dla klienta', () => {
  for (const p of ['plan', 'brak_tekstu', 'w_swz', 'brak_karty', 'limit_dzienny', 'niedostepne']) {
    assert.ok(opisPowodu(p)?.pl, p);
  }
  assert.equal(opisPowodu('nieznany'), null);
});
