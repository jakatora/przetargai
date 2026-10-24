import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PODSTAWY_ZWROTU, FORMY_WADIUM, kwotaWadiumZOgloszenia, generujWniosekOZwrotWadium } from '../src/lib/wniosekZwrotWadium.js';

/*
 * „Wniosek o zwrot wadium w 1 klik" (art. 98 ust. 2 Pzp). Zamawiający zwraca wadium
 * z urzędu tylko w sytuacjach z ust. 1; po wycofaniu/odrzuceniu oferty czy wyborze
 * innej firmy zwrot następuje NA WNIOSEK — a wykonawcy zwlekają, bo „trzeba napisać pismo".
 */

const WYKONAWCA = { nazwa: 'Budrem Sp. z o.o.', adres: 'ul. Długa 12, Kraków', nip: '5261040827', email: 'biuro@budrem.pl', reprezentant: 'Jan Kowalski', miejscowosc: 'Kraków' };
const PRZETARG = { tytul: 'Remont dachu SP 3', zamawiajacy: 'Gmina Kraków', numer: 'ZP.271.14.2026' };

test('katalog podstaw: cztery punkty art. 98 ust. 2 ze stałymi id; formy: przelew i gwarancja', () => {
  assert.deepEqual(PODSTAWY_ZWROTU.map((p) => p.id), ['wycofanie', 'odrzucenie', 'wybor_innej', 'uniewaznienie']);
  for (const p of PODSTAWY_ZWROTU) assert.match(p.podstawa, /art\. 98 ust\. 2 pkt [1-4]/);
  assert.deepEqual(FORMY_WADIUM.map((f) => f.id), ['przelew', 'gwarancja']);
  assert.ok(Object.isFrozen(PODSTAWY_ZWROTU));
});

test('kwotaWadiumZOgloszenia: liczba z ogłoszenia albo null', () => {
  assert.equal(kwotaWadiumZOgloszenia({ wadium_wymagane: true, wadium_kwota: 15000 }), 15000);
  assert.equal(kwotaWadiumZOgloszenia({ wadium_wymagane: true }), null);
  assert.equal(kwotaWadiumZOgloszenia({ wadium_wymagane: false, wadium_kwota: 0 }), null);
  assert.equal(kwotaWadiumZOgloszenia(null), null);
});

test('wniosek po odrzuceniu, wadium przelewem: podstawa pkt 2, kwota PLN, rachunek, 7 dni, podpis', () => {
  const dok = generujWniosekOZwrotWadium({
    wykonawca: WYKONAWCA, przetarg: PRZETARG, dzisiaj: '2026-10-24',
    podstawa: 'odrzucenie',
    wadium: { kwota: '15 000', forma: 'przelew', rachunek: '12 1240 0001 1111 0010 1234 5678', bank: 'Bank Pekao' },
  });
  assert.equal(dok.nazwa, 'Wniosek o zwrot wadium');
  assert.match(dok.tresc, /WNIOSEK O ZWROT WADIUM/);
  assert.match(dok.tresc, /art\. 98 ust\. 2 pkt 2/);
  assert.match(dok.tresc, /odrzuceni/i);
  assert.match(dok.tresc, /15 000,00 zł/);
  assert.match(dok.tresc, /12 1240 0001 1111 0010 1234 5678/);
  assert.match(dok.tresc, /Bank Pekao/);
  assert.match(dok.tresc, /7 dni/);
  assert.match(dok.tresc, /Gmina Kraków/);
  assert.match(dok.tresc, /Kraków, 24\.10\.2026/);
  assert.match(dok.tresc, /Jan Kowalski/);
  assert.doesNotMatch(dok.tresc, /gwarant/i, 'przy przelewie nie ma mowy o zwolnieniu gwarancji');
});

test('wniosek przy gwarancji: zamiast rachunku — oświadczenie o zwolnieniu gwarancji do gwaranta (art. 98 ust. 5)', () => {
  const dok = generujWniosekOZwrotWadium({
    wykonawca: WYKONAWCA, przetarg: PRZETARG, dzisiaj: '2026-10-24',
    podstawa: 'wybor_innej',
    wadium: { kwota: '15000', forma: 'gwarancja', gwarant: 'TUiR Warta S.A.', numerGwarancji: 'GW/2026/0451' },
  });
  assert.match(dok.tresc, /art\. 98 ust\. 2 pkt 3/);
  assert.match(dok.tresc, /oświadczeni\w+ o zwolnieniu wadium/i);
  assert.match(dok.tresc, /art\. 98 ust\. 5/);
  assert.match(dok.tresc, /TUiR Warta S\.A\./);
  assert.match(dok.tresc, /GW\/2026\/0451/);
  assert.doesNotMatch(dok.tresc, /rachunek bankowy nr/i);
});

test('wniosek: nieznana podstawa → ogólna z ust. 2; brak danych → kropki, nigdy „undefined"', () => {
  const dok = generujWniosekOZwrotWadium({});
  assert.match(dok.tresc, /art\. 98 ust\. 2/);
  assert.match(dok.tresc, /…/);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});
