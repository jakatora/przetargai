import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZDARZENIA, znaneZdarzenie, zbudujZdarzenie } from '../src/lib/zdarzenia.js';

test('katalog ma stabilne nazwy w konwencji obszar.czynnosc', () => {
  assert.equal(ZDARZENIA.NARZEDZIE_OTWARTE, 'narzedzie.otwarte');
  for (const nazwa of Object.values(ZDARZENIA)) {
    assert.match(nazwa, /^[a-z]+\.[a-z_]+$/);
  }
});

test('znaneZdarzenie rozpoznaje katalog i odrzuca literówki', () => {
  assert.equal(znaneZdarzenie('narzedzie.otwarte'), true);
  assert.equal(znaneZdarzenie('narzedzieOtwarte'), false);
});

test('zbudujZdarzenie rzuca dla nieznanej nazwy', () => {
  assert.throws(() => zbudujZdarzenie('coś.dziwnego'), /Nieznane zdarzenie/);
});

test('zbudujZdarzenie zostawia tylko wartości proste', () => {
  const rek = zbudujZdarzenie(ZDARZENIA.EKRAN_OTWARTY, {
    ekran: 'Narzedzia',
    liczba: 3,
    aktywne: true,
    obiekt: { a: 1 },
    funkcja: () => {},
    pusty: null,
  }, { czasMs: 1000 });
  assert.deepEqual(rek.props, { ekran: 'Narzedzia', liczba: 3, aktywne: true });
  assert.equal(rek.czasMs, 1000);
  assert.equal(rek.nazwa, 'ekran.otwarty');
});

test('brak props → pusty obiekt, czasMs null gdy nie podano', () => {
  const rek = zbudujZdarzenie(ZDARZENIA.APLIKACJA_START);
  assert.deepEqual(rek.props, {});
  assert.equal(rek.czasMs, null);
});
