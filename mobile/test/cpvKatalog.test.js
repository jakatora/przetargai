import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KATALOG_CPV,
  bezOgonkow,
  kodyZTekstu,
  przelaczKod,
  szukajWKatalogu,
} from '../src/lib/cpvKatalog.js';

/*
 * Ściąga kodów CPV. Silnik dopasowań traktuje kody firmy jako PREFIKSY
 * (zera końcowe = deklaracja szerokości, cyfra kontrolna odcinana), więc
 * katalog może podpowiadać zarówno całe działy (45000000), jak i węższe
 * klasy (45440000) — im węższy kod, tym wyższa punktacja dopasowania.
 */

// ---------------- struktura katalogu ----------------

test('katalog: każdy kod to dokładnie 8 cyfr, nazwy niepuste', () => {
  for (const dzial of KATALOG_CPV) {
    assert.match(dzial.kod, /^\d{8}$/, `dział ${dzial.kod}`);
    assert.ok(dzial.nazwa.trim().length > 0);
    for (const dziecko of dzial.dzieci ?? []) {
      assert.match(dziecko.kod, /^\d{8}$/, `kod ${dziecko.kod}`);
      assert.ok(dziecko.nazwa.trim().length > 0);
    }
  }
});

test('katalog: kody unikalne w całym katalogu', () => {
  const wszystkie = KATALOG_CPV.flatMap((d) => [d.kod, ...(d.dzieci ?? []).map((c) => c.kod)]);
  assert.equal(new Set(wszystkie).size, wszystkie.length);
});

test('katalog: dziecko należy do swojego działu (te same 2 pierwsze cyfry)', () => {
  for (const dzial of KATALOG_CPV) {
    for (const dziecko of dzial.dzieci ?? []) {
      assert.equal(
        dziecko.kod.slice(0, 2),
        dzial.kod.slice(0, 2),
        `${dziecko.kod} (${dziecko.nazwa}) nie należy do działu ${dzial.kod}`,
      );
    }
  }
});

test('katalog: obejmuje wszystkie 45 działów słownika CPV', () => {
  // Pełna lista działów z rozporządzenia 213/2008 — ściąga nie może mieć dziur,
  // bo użytkownik z niszowej branży nie znajdzie NIC i uzna funkcję za zepsutą.
  const oczekiwane = [
    '03', '09', '14', '15', '16', '18', '19', '22', '24', '30', '31', '32',
    '33', '34', '35', '37', '38', '39', '41', '42', '43', '44', '45', '48',
    '50', '51', '55', '60', '63', '64', '65', '66', '70', '71', '72', '73',
    '75', '76', '77', '79', '80', '85', '90', '92', '98',
  ];
  const mamy = KATALOG_CPV.map((d) => d.kod.slice(0, 2));
  assert.deepEqual([...new Set(mamy)].sort(), oczekiwane);
});

test('katalog: dział = kod z samymi zerami po dwóch pierwszych cyfrach', () => {
  for (const dzial of KATALOG_CPV) {
    assert.match(dzial.kod, /^\d{2}0{6}$/, `${dzial.kod} nie jest kodem działu`);
  }
});

// ---------------- normalizacja polskich znaków ----------------

test('bezOgonkow: zdejmuje polskie znaki włącznie z ł/Ł', () => {
  assert.equal(bezOgonkow('Zażółć gęślą jaźń'), 'zazolc gesla jazn');
  assert.equal(bezOgonkow('ŁĄKA'), 'laka');
});

// ---------------- parsowanie pola tekstowego ----------------

test('kodyZTekstu: rozumie kody z cyfrą kontrolną i bez, bez duplikatów', () => {
  assert.deepEqual(
    kodyZTekstu('45000000, 45310000-3, 45000000'),
    ['45000000', '45310000'],
  );
  assert.deepEqual(kodyZTekstu(''), []);
  assert.deepEqual(kodyZTekstu(null), []);
  assert.deepEqual(kodyZTekstu('meble, drzwi'), [], 'słowa to nie kody');
});

// ---------------- przełączanie kodu (tap w ściądze) ----------------

test('przelaczKod: dodaje nieobecny kod na koniec listy', () => {
  assert.equal(przelaczKod('', '45000000'), '45000000');
  assert.equal(przelaczKod('45000000', '90910000'), '45000000, 90910000');
});

test('przelaczKod: usuwa obecny kod, resztę zostawia', () => {
  assert.equal(przelaczKod('45000000, 90910000', '45000000'), '90910000');
});

test('przelaczKod: rozpoznaje kod zapisany z cyfrą kontrolną', () => {
  // Użytkownik wpisał ręcznie "45310000-3" — tap na 45310000 ma go USUNĄĆ, nie zdublować.
  assert.equal(przelaczKod('45310000-3', '45310000'), '');
});

// ---------------- wyszukiwanie ----------------

test('szukajWKatalogu: po nazwie, bez wrażliwości na ogonki i wielkość liter', () => {
  const malarskie = szukajWKatalogu('malar');
  assert.ok(malarskie.some((w) => w.kod === '45440000'), 'brak robót malarskich');

  const sprzatanie = szukajWKatalogu('sprzatanie'); // bez „ą"
  assert.ok(sprzatanie.some((w) => w.kod === '90910000'), 'brak usług sprzątania');
});

test('szukajWKatalogu: po prefiksie kodu', () => {
  const wyniki = szukajWKatalogu('4531');
  assert.ok(wyniki.some((w) => w.kod === '45310000'));
  assert.ok(wyniki.every((w) => w.kod.startsWith('4531')));
});

test('szukajWKatalogu: puste zapytanie = null (pokaż cały katalog), brak trafień = []', () => {
  assert.equal(szukajWKatalogu(''), null);
  assert.equal(szukajWKatalogu('   '), null);
  assert.deepEqual(szukajWKatalogu('qqqxyz'), []);
});
