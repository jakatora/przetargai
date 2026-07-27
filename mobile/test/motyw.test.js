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

test('kontrast akcentów: MAŁY tekst akcentu ma AA ≥4.5:1 na swoim tle (obie palety)', () => {
  /*
   * Krytyk graficzny dwukrotnie wytknął „zmulony" akcent na małym tekście: raz
   * brązowy akcent ostrzeżenia (Radar SWZ → `ostrzezenieAkcent` żywy bursztyn),
   * raz zieleń badge'a „Łatwiejszy start" na jasnym tle (green 3.0:1 →
   * `sukcesAkcent` ciemniejsza zieleń). Te akcenty są DROBNYM tekstem (10-16 px),
   * więc obowiązuje próg AA dla normalnego tekstu (4.5:1), nie 3:1 dla dużego.
   * Ten test blokuje ponowne osunięcie kontrastu poniżej progu.
   */
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const kontrast = (fg, bg) => {
    const a = L(fg) + 0.05; const b = L(bg) + 0.05;
    return Math.max(a, b) / Math.min(a, b);
  };
  // [token akcentu, tła, na których pojawia się jako mały tekst]
  const pary = [
    ['sukcesAkcent', ['surface', 'sukcesTlo']],   // badge „Łatwiejszy start" + tytuł banera „w porę" + potwierdzenie
    ['ostrzezenieAkcent', ['surface']],           // tytuł/obwódka banera „pilne" + chip odliczania
  ];
  for (const [schemat, paleta] of Object.entries(PALETY)) {
    for (const [akcent, tla] of pary) {
      for (const tlo of tla) {
        const r = kontrast(paleta[akcent], paleta[tlo]);
        assert.ok(r >= 4.5, `${schemat}: ${akcent} (${paleta[akcent]}) na ${tlo} (${paleta[tlo]}) = ${r.toFixed(2)}:1 — poniżej AA 4.5:1`);
      }
    }
  }
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
