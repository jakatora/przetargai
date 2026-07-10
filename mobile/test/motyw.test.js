import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PALETY,
  PREFERENCJE,
  normalizujPreferencje,
  wybierzSchemat,
} from '../src/lib/motyw.js';

/*
 * Tryb ciemny (życzenie usera). Czysta logika wyboru schematu żyje poza
 * Reactem, żeby dało się ją testować bez renderera. Trzy preferencje:
 * 'system' (podążaj za telefonem), 'jasny', 'ciemny'.
 */

test('preferencja "system" podąża za schematem systemowym', () => {
  assert.equal(wybierzSchemat('system', 'dark'), 'ciemny');
  assert.equal(wybierzSchemat('system', 'light'), 'jasny');
});

test('brak informacji z systemu = jasny (bezpieczny domyślny)', () => {
  assert.equal(wybierzSchemat('system', null), 'jasny');
  assert.equal(wybierzSchemat('system', undefined), 'jasny');
});

test('jawna preferencja wygrywa z systemem', () => {
  assert.equal(wybierzSchemat('ciemny', 'light'), 'ciemny');
  assert.equal(wybierzSchemat('jasny', 'dark'), 'jasny');
});

test('normalizujPreferencje: śmieci z magazynu nie wywracają aplikacji', () => {
  // Magazyn może zawierać starą/uszkodzoną wartość — wracamy do 'system'.
  assert.equal(normalizujPreferencje('ciemny'), 'ciemny');
  assert.equal(normalizujPreferencje('neon'), 'system');
  assert.equal(normalizujPreferencje(null), 'system');
  assert.equal(normalizujPreferencje(undefined), 'system');
  assert.equal(normalizujPreferencje(42), 'system');
});

test('PREFERENCJE: dokładnie trzy, w kolejności prezentacji', () => {
  assert.deepEqual(PREFERENCJE, ['system', 'jasny', 'ciemny']);
});

test('parytet tokenów: obie palety mają IDENTYCZNE klucze', () => {
  /*
   * Najczęstsza awaria dark mode: nowy token dodany tylko do jasnej palety →
   * w ciemnej `undefined` → niewidoczny tekst. Ten test to uniemożliwia.
   */
  const jasne = Object.keys(PALETY.jasny).sort();
  const ciemne = Object.keys(PALETY.ciemny).sort();
  assert.deepEqual(ciemne, jasne);
});

test('palety: każdy token to kolor (#hex lub rgba), bez undefined', () => {
  for (const [schemat, paleta] of Object.entries(PALETY)) {
    for (const [token, wartosc] of Object.entries(paleta)) {
      assert.match(
        String(wartosc),
        /^(#[0-9a-fA-F]{3,8}|rgba?\(.+\))$/,
        `${schemat}.${token} = ${wartosc}`,
      );
    }
  }
});

test('ciemna paleta faktycznie jest ciemna (tło ciemne, tekst jasny)', () => {
  // Prosta jasność percepcyjna — chroni przed odwróceniem wartości przy edycji.
  const jasnosc = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000;
  };
  assert.ok(jasnosc(PALETY.ciemny.bg) < 60, 'tło ciemnego ma być ciemne');
  assert.ok(jasnosc(PALETY.ciemny.text) > 180, 'tekst ciemnego ma być jasny');
  assert.ok(jasnosc(PALETY.jasny.bg) > 200, 'tło jasnego ma być jasne');
  assert.ok(jasnosc(PALETY.jasny.text) < 80, 'tekst jasnego ma być ciemny');
});
