import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsujWadium } from '../src/lib/wadium.js';

/*
 * WADIUM (feature #1 z researchu 2026-07-17) — najgroźniejszy „twardy próg":
 * brak wadium przed terminem = odrzucenie oferty, bez uzupełnienia. Kwota jest
 * w `htmlBody` ogłoszenia (który i tak parsujemy przy ingestii). Fixture'y to
 * DOSŁOWNE fragmenty realnych ogłoszeń BZP (zmierzone na żywo 2026-07-16).
 */

test('wadium NIE wymagane → { wymagane: false }', () => {
  const h = '<h3 class="mb-0">6.4.) Zamawiający wymaga wadium: Nie 6.5.) Zamawiający wymaga zabezpieczenia...';
  assert.deepEqual(parsujWadium(h), { wymagane: false, kwota: null });
});

test('wadium wymagane, jedna kwota „7 800,00 zł"', () => {
  const h = '6.4.) Zamawiający wymaga wadium: Tak 6.4.1) Informacje dotyczące wadium: 1. Oferta musi być zabezpieczona wadium w wysokości 7 800,00 zł (słownie: siedemtysięcyosiemset złotych 00/100). 2. Wadium wnosi się przed upływem...';
  const w = parsujWadium(h);
  assert.equal(w.wymagane, true);
  assert.equal(w.kwota, 7800);
  assert.equal(w.wieleCzesci, false);
});

test('wadium na części — bierze pierwszą kwotę i oznacza wieleCzesci', () => {
  const h = '6.4.) Zamawiający wymaga wadium: Tak 6.4.1) Informacje dotyczące wadium: 1. Oferta musi być zabezpieczona wadium w wysokości: ZADANIE nr I – 8 000 zł (słownie: osiem tysięcy złotych), ZADANIE nr II – 12 000 zł (słownie...)';
  const w = parsujWadium(h);
  assert.equal(w.wymagane, true);
  assert.equal(w.kwota, 8000, 'pierwsza kwota jako orientacyjna');
  assert.equal(w.wieleCzesci, true, 'oznaczamy, że kwot jest więcej');
});

test('wadium: Tak, ale bez parsowalnej kwoty → kwota null (nie zmyślamy)', () => {
  const h = '6.4.) Zamawiający wymaga wadium: Tak 6.4.1) Informacje dotyczące wadium: zgodnie z rozdziałem XV SWZ.';
  assert.deepEqual(parsujWadium(h), { wymagane: true, kwota: null, wieleCzesci: false });
});

test('brak wzmianki o wadium → { wymagane: null } (nie wiadomo)', () => {
  assert.deepEqual(parsujWadium('SEKCJA V - jakieś inne dane'), { wymagane: null, kwota: null });
  assert.deepEqual(parsujWadium(''), { wymagane: null, kwota: null });
  assert.deepEqual(parsujWadium(null), { wymagane: null, kwota: null });
});

test('nie łapie kwot spoza sekcji wadium (np. wartości umowy dalej w dokumencie)', () => {
  const h = '6.4.) Zamawiający wymaga wadium: Nie ... dużo tekstu ... 8.2.) Wartość umowy: 547 542,00 zł';
  assert.deepEqual(parsujWadium(h), { wymagane: false, kwota: null }, 'Nie = nie szukamy kwoty');
});

test('kwoty z twardą spacją (nbsp) i „PLN"', () => {
  const h = '6.4.) Zamawiający wymaga wadium: Tak 6.4.1) w wysokości 15 000,00 PLN';
  assert.equal(parsujWadium(h).kwota, 15000);
});
