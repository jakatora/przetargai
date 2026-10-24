import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generujWniosekOWyjasnienie } from '../src/lib/wniosekWyjasnienieSwz.js';

/*
 * „Wniosek o wyjaśnienie treści SWZ w 1 klik": pytania wygenerowane przez Radar SWZ
 * składają się w formalne pismo do zamawiającego (art. 135 ust. 1 / art. 284 ust. 1 Pzp).
 * Leniwy wykonawca nie pisze pisma od zera — i nie przegapia terminu pytań.
 */

const WYKONAWCA = { nazwa: 'Budrem Sp. z o.o.', adres: 'ul. Długa 12, Kraków', nip: '5261040827', email: 'biuro@budrem.pl', reprezentant: 'Jan Kowalski', miejscowosc: 'Kraków' };
const PYTANIA = [
  { id: 1, tresc: 'Czy zamawiający dopuszcza dachówkę ceramiczną zamiast betonowej?', fragment_swz: 'Rozdział III pkt 2.4', status: 'szkic' },
  { id: 2, tresc: 'Jaki jest wymagany okres gwarancji — SWZ podaje 36 i 60 miesięcy?', fragment_swz: null, status: 'szkic' },
  { id: 3, tresc: '', status: 'szkic' },
];

test('wniosek: podstawa dla trybu krajowego, pytania numerowane z fragmentem SWZ, puste pominięte, podpis', () => {
  const dok = generujWniosekOWyjasnienie({ wykonawca: WYKONAWCA, postepowanie: { nazwa: 'Remont dachu SP 3', zamawiajacy: 'Gmina Kraków', numer: 'ZP.1/2026' }, pytania: PYTANIA, tryb: 'krajowy', dzisiaj: '2026-10-24' });
  assert.equal(dok.nazwa, 'Wniosek o wyjaśnienie treści SWZ');
  assert.match(dok.tresc, /art\. 284 ust\. 1/);
  assert.doesNotMatch(dok.tresc, /art\. 135/);
  assert.match(dok.tresc, /1\. Czy zamawiający dopuszcza/);
  assert.match(dok.tresc, /\(dotyczy: Rozdział III pkt 2\.4\)/);
  assert.match(dok.tresc, /2\. Jaki jest wymagany okres gwarancji/);
  assert.doesNotMatch(dok.tresc, /3\./, 'puste pytanie nie wchodzi');
  assert.equal(dok.liczba, 2);
  assert.match(dok.tresc, /Gmina Kraków/);
  assert.match(dok.tresc, /Budrem Sp\. z o\.o\./);
  assert.match(dok.tresc, /Kraków, 24\.10\.2026/);
  assert.match(dok.tresc, /Jan Kowalski/);
  assert.match(dok.tresc, /bez ujawniania/i, 'prośba o anonimizację źródła pytań');
});

test('wniosek: tryb unijny = art. 135; brak trybu = obie podstawy „odpowiednio"', () => {
  assert.match(generujWniosekOWyjasnienie({ pytania: PYTANIA, tryb: 'unijny' }).tresc, /art\. 135 ust\. 1/);
  const oba = generujWniosekOWyjasnienie({ pytania: PYTANIA }).tresc;
  assert.match(oba, /art\. 284 ust\. 1/);
  assert.match(oba, /art\. 135 ust\. 1/);
});

test('wniosek: brak pytań → jasny komunikat w treści i liczba 0; brak danych → kropki, nie „undefined"', () => {
  const dok = generujWniosekOWyjasnienie({});
  assert.equal(dok.liczba, 0);
  assert.match(dok.tresc, /brak pytań/i);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});
