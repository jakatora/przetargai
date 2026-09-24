import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analizujPole,
  bladKwoty,
  bladProcentu,
  bladLiczby,
  zbierzBledy,
} from '../src/lib/walidacjaLiczb.js';

test('analizujPole: puste i same spacje = pusty, bez błędu', () => {
  assert.deepEqual(analizujPole(''), { pusty: true, liczba: null });
  assert.deepEqual(analizujPole('   '), { pusty: true, liczba: null });
  assert.deepEqual(analizujPole(undefined), { pusty: true, liczba: null });
});

test('analizujPole: polski zapis — przecinek dziesiętny i spacje tysięcy', () => {
  assert.equal(analizujPole('1 200,50').liczba, 1200.5);
  assert.equal(analizujPole('0,5').liczba, 0.5);
});

test('analizujPole: „1.200,50" (kropka tysięcy + przecinek) NIE jest liczbą — dotąd liczyło się jako 0', () => {
  assert.equal(analizujPole('1.200,50').liczba, null);
  assert.equal(analizujPole('1,2,3').liczba, null);
});

// Klawiatura liczbowa Androida ma kropkę. „1.200" wpisane jako 1200 zł liczyło się jako 1,20 zł.
test('analizujPole: kropka z dokładnie trzema cyframi („1.200", „12.500") jest NIEJEDNOZNACZNA', () => {
  assert.deepEqual(analizujPole('1.200'), { pusty: false, liczba: null, niejednoznaczny: true });
  assert.equal(analizujPole('12.500').niejednoznaczny, true);
  assert.equal(analizujPole('1.200.000').niejednoznaczny, true);
});

test('analizujPole: zwykły ułamek z kropką zostaje liczbą („1.5", „0.500", „2.25")', () => {
  assert.equal(analizujPole('1.5').liczba, 1.5);
  assert.equal(analizujPole('0.500').liczba, 0.5);
  assert.equal(analizujPole('2.25').liczba, 2.25);
  assert.equal(analizujPole('1200').niejednoznaczny, false);
});

test('bladKwoty/bladProcentu/bladLiczby: przy niejednoznacznym zapisie podpowiadają oba odczyty', () => {
  assert.equal(bladKwoty('1.200'), 'Niejednoznaczny zapis „1.200" — wpisz 1200 (bez kropki) albo 1,2 (z przecinkiem)');
  assert.equal(bladProcentu('12.500', { max: 1000 }), 'Niejednoznaczny zapis „12.500" — wpisz 12500 (bez kropki) albo 12,5 (z przecinkiem)');
  assert.equal(bladLiczby('1.200.000', {}), 'Niejednoznaczny zapis „1.200.000" — wpisz 1200000 (bez kropek)');
});

test('bladKwoty: pusta = brak błędu, liczba = brak, śmieci i minus = komunikat', () => {
  assert.equal(bladKwoty(''), null);
  assert.equal(bladKwoty('1200,00'), null);
  assert.equal(bladKwoty('1.200,50'), 'Podaj kwotę jako liczbę, np. 1200,00');
  assert.equal(bladKwoty('-5'), 'Kwota nie może być ujemna');
});

test('bladProcentu: zakres z etykietą w komunikacie', () => {
  assert.equal(bladProcentu('23', { max: 100, etykieta: 'Stawka' }), null);
  assert.equal(bladProcentu('150', { max: 100, etykieta: 'Stawka' }), 'Stawka spoza zakresu 0–100%');
  assert.equal(bladProcentu('1200', { max: 1000, etykieta: 'Narzut' }), 'Narzut spoza zakresu 0–1000%');
  assert.equal(bladProcentu('x,,', { max: 100 }), 'Podaj procent jako liczbę, np. 10');
});

test('bladLiczby: liczba całkowita (dni, sztuki) i zakres', () => {
  assert.equal(bladLiczby('30', { calkowita: true }), null);
  assert.equal(bladLiczby('2,5', { calkowita: true }), 'Podaj liczbę całkowitą');
  assert.equal(bladLiczby('0', { min: 1 }), 'Wartość musi wynosić co najmniej 1');
  assert.equal(bladLiczby('120', { max: 100 }), 'Wartość nie może przekraczać 100');
  assert.equal(bladLiczby('abc,,', {}), 'Podaj liczbę, np. 10');
});

test('zbierzBledy: pomija null, liczy maBledy', () => {
  assert.deepEqual(zbierzBledy({ a: null, b: null }), { bledy: {}, maBledy: false });
  assert.deepEqual(zbierzBledy({ a: 'zle', b: null }), { bledy: { a: 'zle' }, maBledy: true });
});
