import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsujSugestie, buildProfilPrompt } from '../src/lib/profilSugestia.js';

/*
 * Onboarding AI (rundy 9-10): „opisz firmę" → AI proponuje słowa kluczowe + CPV.
 * Rozwiązuje największy wyciek aktywacji — właściciel JDG nie zna kodów CPV.
 * Czysta logika: budowa promptu + sanityzacja odpowiedzi modelu (której nie ufamy).
 */

// ---------------- parsujSugestie ----------------

const DOBRA = JSON.stringify({
  keywords: ['kostka brukowa', 'układanie chodników', 'roboty drogowe'],
  cpv: ['45233222-1', '45233200-1'],
});

test('parsuje słowa i CPV z poprawnego JSON', () => {
  const s = parsujSugestie(DOBRA);
  assert.deepEqual(s.keywords, ['kostka brukowa', 'układanie chodników', 'roboty drogowe']);
  assert.deepEqual(s.cpv, ['45233222', '45233200'], 'CPV do 8 cyfr, bez sufiksu kontrolnego');
});

test('wyłuskuje JSON otoczony prozą modelu', () => {
  const s = parsujSugestie(`Oto propozycja:\n${DOBRA}\nPowodzenia!`);
  assert.ok(s.keywords.length === 3 && s.cpv.length === 2);
});

test('sanityzacja: puste/duplikaty/nadmiar wycięte, limity', () => {
  const s = parsujSugestie(JSON.stringify({
    keywords: ['A', 'A', '', '   ', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    cpv: ['45000000-7', '45000000', 'nonsens', '4510', '45100000-8', '45200000', '45300000', '45400000', '45500000'],
  }));
  assert.ok(s.keywords.length <= 8, 'maks 8 słów');
  assert.equal(new Set(s.keywords).size, s.keywords.length, 'bez duplikatów');
  assert.ok(!s.keywords.includes(''), 'bez pustych');
  assert.ok(s.cpv.length <= 6, 'maks 6 kodów CPV');
  assert.ok(s.cpv.every((c) => /^\d{8}$/.test(c)), 'każdy CPV to 8 cyfr');
  assert.equal(new Set(s.cpv).size, s.cpv.length, 'CPV bez duplikatów (45000000-7 i 45000000 = ten sam)');
});

test('śmieci / brak JSON → puste listy (nie wywala się)', () => {
  assert.deepEqual(parsujSugestie('nie wiem'), { keywords: [], cpv: [] });
  assert.deepEqual(parsujSugestie(''), { keywords: [], cpv: [] });
  assert.deepEqual(parsujSugestie(JSON.stringify({ keywords: 'nie tablica' })), { keywords: [], cpv: [] });
});

// ---------------- buildProfilPrompt ----------------

test('prompt niesie opis firmy i prosi o JSON', () => {
  const p = buildProfilPrompt('Kładę kostkę brukową i buduję ogrodzenia');
  assert.match(p, /kostkę brukową/);
  assert.match(p, /CPV/);
  assert.match(p, /keywords/);
});

test('prompt obcina zbyt długi opis (obrona przed nadużyciem)', () => {
  const p = buildProfilPrompt('x'.repeat(5000));
  assert.ok(p.length < 3000, 'opis przycięty');
});
