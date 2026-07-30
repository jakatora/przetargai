import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocenHaslo, walidujZmianeEmaila } from '../src/lib/bezpieczenstwoKonta.js';

test('ocenHaslo: za krótkie odrzucone', () => {
  const w = ocenHaslo('krotkie', 'krotkie');
  assert.equal(w.poprawne, false);
  assert.match(w.komunikat, /8 znaków/);
});

test('ocenHaslo: niezgodne powtórzenie odrzucone', () => {
  const w = ocenHaslo('dlugiehaslo', 'inne_haslo1');
  assert.equal(w.poprawne, false);
  assert.match(w.komunikat, /takie samo/);
});

test('ocenHaslo: poprawne gdy długie i zgodne', () => {
  assert.equal(ocenHaslo('mojeNoweHaslo1', 'mojeNoweHaslo1').poprawne, true);
});

test('walidujZmianeEmaila: normalizuje i akceptuje poprawny', () => {
  const w = walidujZmianeEmaila('  NOWY@Firma.PL ', 'stary@firma.pl');
  assert.equal(w.poprawne, true);
  assert.equal(w.email, 'nowy@firma.pl');
});

test('walidujZmianeEmaila: odrzuca ten sam adres (po normalizacji)', () => {
  const w = walidujZmianeEmaila('STARY@firma.pl', 'stary@firma.pl');
  assert.equal(w.poprawne, false);
  assert.match(w.komunikat, /aktualny/);
});

test('walidujZmianeEmaila: odrzuca niepoprawny i pusty', () => {
  assert.equal(walidujZmianeEmaila('bezmalpy', 'x@y.pl').poprawne, false);
  assert.equal(walidujZmianeEmaila('', 'x@y.pl').poprawne, false);
});
