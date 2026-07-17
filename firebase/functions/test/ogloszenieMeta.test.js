import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsujKryterium, parsujCzesci } from '../src/lib/ogloszenieMeta.js';

/*
 * Meta ogłoszenia z htmlBody (rundy 5-6). Fixture'y to DOSŁOWNE fragmenty realnych
 * ogłoszeń BZP (zmierzone 2026-07-16). Dwie rzeczy decydujące dla małej firmy:
 *  • kryterium — czy wygrywa TYLKO najniższa cena (twardo dla małych marż),
 *    czy liczy się też jakość/doświadczenie,
 *  • liczba części — podział = mniejsze loty = dostępniejsze dla JDG.
 */

// ---------------- kryterium ----------------

test('tylko cena: „oferta z najniższą ceną"', () => {
  const h = '4.3.) Kryteria oceny ofert: 4.3.1.) Sposób oceny ofert: Za ofertę najwyżej ocenioną zostanie uznana oferta z najniższą ceną 4.3.2.) ...';
  assert.equal(parsujKryterium(h), 'tylko_cena');
});

test('cena i jakość: „oraz kryteria jakościowe"', () => {
  const h = '4.3.) Kryteria oceny ofert: 4.3.3.) Stosowane kryteria oceny ofert: Kryterium ceny oraz kryteria jakościowe Kryterium 1 ...';
  assert.equal(parsujKryterium(h), 'cena_i_jakosc');
});

test('kryteria jakościowe wygrywają, nawet gdy „cena" też pada', () => {
  const h = '4.3.) Kryteria oceny ofert: Kryterium ceny 60%, kryterium jakości 40%';
  assert.equal(parsujKryterium(h), 'cena_i_jakosc');
});

test('brak sekcji kryteriów → null (nie zgadujemy)', () => {
  assert.equal(parsujKryterium('SEKCJA V jakiś inny tekst'), null);
  assert.equal(parsujKryterium(''), null);
  assert.equal(parsujKryterium(null), null);
});

// ---------------- liczba części ----------------

test('liczba części: „podzielone na 5 części" → 5', () => {
  const h = '2.10.) (kwestia dotycząca zamówienie podzielone na 5 części) 2.11.) O udzielenie ...';
  assert.equal(parsujCzesci(h), 5);
});

test('jawnie niepodzielone → 1', () => {
  assert.equal(parsujCzesci('Zamawiający nie dopuszcza składania ofert częściowych.'), 1);
  assert.equal(parsujCzesci('Zamówienie nie zostało podzielone na części.'), 1);
});

test('warunkowa wzmianka bez liczby → null (to nie deklaracja podziału)', () => {
  assert.equal(parsujCzesci('gdy zamówienie zostanie podzielone na części, do przygotowania...'), null);
  assert.equal(parsujCzesci(''), null);
});
