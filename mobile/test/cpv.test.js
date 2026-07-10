import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opisCpv } from '../src/lib/cpv.js';

/*
 * BZP zwraca kody CPV jako JEDEN sklejony string, np.
 *   "39100000-3 (Meble),39150000-8 (Różne meble i wyposażenie)"
 * — bez spacji po przecinku (patrz reference_bzp_api_dane: 70,8% ogłoszeń
 * ma więcej niż jeden kod). Wyświetlane wprost wygląda jak literówka.
 */

test('pojedynczy kod: etykieta w liczbie pojedynczej', () => {
  const { etykieta, wartosc } = opisCpv('45420000-9 (Stolarka budowlana)');
  assert.equal(etykieta, 'Kod CPV');
  assert.equal(wartosc, '45420000-9 (Stolarka budowlana)');
});

test('wiele kodów: liczba mnoga i każdy kod w osobnej linii', () => {
  const { etykieta, wartosc } = opisCpv('39100000-3 (Meble),39150000-8 (Różne meble i wyposażenie)');
  assert.equal(etykieta, 'Kody CPV');
  assert.equal(wartosc, '39100000-3 (Meble)\n39150000-8 (Różne meble i wyposażenie)');
});

test('przecinek WEWNĄTRZ nawiasu nie rozdziela kodu', () => {
  // Nazwy CPV bywają z przecinkiem: "Meble, wyposażenie, urządzenia".
  const { etykieta, wartosc } = opisCpv('39100000-3 (Meble, wyposażenie i sprzęt)');
  assert.equal(etykieta, 'Kod CPV', 'to JEDEN kod, nie dwa');
  assert.equal(wartosc, '39100000-3 (Meble, wyposażenie i sprzęt)');
});

test('nadmiarowe spacje i puste segmenty znikają', () => {
  const { wartosc } = opisCpv('45000000-7 ,  , 45300000-0');
  assert.equal(wartosc, '45000000-7\n45300000-0');
});

test('brak danych: etykieta pojedyncza, czytelny komunikat', () => {
  for (const puste of ['', '   ', null, undefined]) {
    const { etykieta, wartosc } = opisCpv(puste);
    assert.equal(etykieta, 'Kod CPV');
    assert.equal(wartosc, 'brak danych');
  }
});

test('same przecinki to też brak danych', () => {
  assert.equal(opisCpv(',,,').wartosc, 'brak danych');
});
