import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KOLOR_ZIELONY,
  KOLOR_POMARANCZOWY,
  KOLOR_CZERWONY,
  meta_koloru,
  podsumuj_flagi,
  ryzyko_ogolne,
  porzadkuj_ryzykiem,
} from '../src/lib/flagiUmowy.js';

/*
 * Widok flag prześwietlenia umowy (ekran „Prześwietlenie umowy przed podpisem").
 * Ekran to cienki render — cała logika koloru/ryzyka/kolejności żyje tu i jest
 * testowana bez renderera (mobile nie ma Jesta). Kluczowe niezmienniki:
 *  - kolory zgodne z kontraktem backendu (`zbuduj_flagi_umowy`),
 *  - nieznany/uszkodzony wpis NIGDY nie udaje zieleni,
 *  - „najpierw ryzyko" jest stabilne (nie tasuje flag tego samego koloru).
 */

// Miniaturowa flaga jak z backendu: { typ, kolor, tytul, opis }.
const flaga = (kolor, typ = 't', tytul = 'x') => ({ typ, kolor, tytul, opis: 'o' });

test('meta_koloru: etykieta i waga dla trzech kolorów kontraktu', () => {
  assert.deepEqual(meta_koloru(KOLOR_CZERWONY), { etykieta: 'Ryzyko', ryzyko: 'wysokie', waga: 0 });
  assert.deepEqual(meta_koloru(KOLOR_POMARANCZOWY), { etykieta: 'Uwaga', ryzyko: 'srednie', waga: 1 });
  assert.deepEqual(meta_koloru(KOLOR_ZIELONY), { etykieta: 'W porządku', ryzyko: 'brak', waga: 2 });
});

test('meta_koloru: literał pomarańczowego ma „ą" (parytet z backendem)', () => {
  // Gdyby ktoś podmienił na ASCII-owe „pomaranczowy", flagi ostrzeżeń z backendu
  // (które niosą „ą") wpadłyby do gałęzi „nieznany" — cichy rozjazd skali.
  assert.equal(KOLOR_POMARANCZOWY, 'pomarańczowy');
  assert.notEqual(meta_koloru('pomarańczowy'), meta_koloru('pomaranczowy'));
});

test('meta_koloru: nieznany kolor → „Do sprawdzenia", waga pośrednia (nie zieleń)', () => {
  const m = meta_koloru('turkusowy');
  assert.equal(m.etykieta, 'Do sprawdzenia');
  assert.equal(m.ryzyko, 'nieznane');
  // Waga między czerwonym (0) a zielonym (2) — sortuje się przed „ok".
  assert.ok(m.waga > meta_koloru(KOLOR_CZERWONY).waga);
  assert.ok(m.waga < meta_koloru(KOLOR_ZIELONY).waga);
});

test('podsumuj_flagi: zlicza kolory i sumuje ostrzeżenia', () => {
  const flagi = [
    flaga(KOLOR_ZIELONY),
    flaga(KOLOR_CZERWONY),
    flaga(KOLOR_POMARANCZOWY),
    flaga(KOLOR_ZIELONY),
    flaga('inny'),
  ];
  const p = podsumuj_flagi(flagi);
  assert.equal(p.razem, 5);
  assert.equal(p.zielone, 2);
  assert.equal(p.czerwone, 1);
  assert.equal(p.pomaranczowe, 1);
  assert.equal(p.inne, 1);
  // ostrzeżenia = wszystko poza zielonym (czerwone + pomarańczowe + nieznane)
  assert.equal(p.ostrzezenia, 3);
});

test('podsumuj_flagi: odporny na null / nie-tablicę / uszkodzone wpisy', () => {
  for (const wejscie of [null, undefined, 'x', 42, {}]) {
    const p = podsumuj_flagi(wejscie);
    assert.equal(p.razem, 0);
    assert.equal(p.ostrzezenia, 0);
  }
  // null-e i stringi w liście są odsiewane, liczą się tylko obiekty-flagi.
  const p = podsumuj_flagi([null, 'x', flaga(KOLOR_CZERWONY), undefined]);
  assert.equal(p.razem, 1);
  assert.equal(p.czerwone, 1);
});

test('ryzyko_ogolne: bierze poziom najgroźniejszej flagi', () => {
  assert.equal(ryzyko_ogolne([]), 'brak');
  assert.equal(ryzyko_ogolne(null), 'brak');
  assert.equal(ryzyko_ogolne([flaga(KOLOR_ZIELONY), flaga(KOLOR_ZIELONY)]), 'niskie');
  assert.equal(ryzyko_ogolne([flaga(KOLOR_ZIELONY), flaga(KOLOR_POMARANCZOWY)]), 'srednie');
  assert.equal(ryzyko_ogolne([flaga(KOLOR_ZIELONY), flaga('inny')]), 'srednie');
  // Choćby jedna czerwona → wysokie, niezależnie od reszty.
  assert.equal(ryzyko_ogolne([flaga(KOLOR_ZIELONY), flaga(KOLOR_CZERWONY), flaga(KOLOR_POMARANCZOWY)]), 'wysokie');
});

test('porzadkuj_ryzykiem: czerwone → pomarańczowe/nieznane → zielone', () => {
  const flagi = [
    flaga(KOLOR_ZIELONY, 'a'),
    flaga(KOLOR_CZERWONY, 'b'),
    flaga(KOLOR_POMARANCZOWY, 'c'),
    flaga('inny', 'd'),
  ];
  const kolory = porzadkuj_ryzykiem(flagi).map((f) => f.kolor);
  assert.equal(kolory[0], KOLOR_CZERWONY);
  assert.equal(kolory[kolory.length - 1], KOLOR_ZIELONY);
  // pomarańczowe i nieznane są w środku (obie waga 1), przed zielenią
  assert.ok(kolory.slice(1, 3).every((k) => k === KOLOR_POMARANCZOWY || k === 'inny'));
});

test('porzadkuj_ryzykiem: STABILNY w obrębie koloru (kolejność obszarów z backendu)', () => {
  // Wszystkie zielone — kolejność typów musi zostać dokładnie taka jak weszła.
  const flagi = [
    flaga(KOLOR_ZIELONY, 'waloryzacja'),
    flaga(KOLOR_ZIELONY, 'kary'),
    flaga(KOLOR_ZIELONY, 'odbiory'),
    flaga(KOLOR_ZIELONY, 'podwykonawcy'),
  ];
  const typy = porzadkuj_ryzykiem(flagi).map((f) => f.typ);
  assert.deepEqual(typy, ['waloryzacja', 'kary', 'odbiory', 'podwykonawcy']);
});

test('porzadkuj_ryzykiem: nie mutuje wejścia i odsiewa śmieci', () => {
  const flagi = [flaga(KOLOR_ZIELONY, 'a'), null, flaga(KOLOR_CZERWONY, 'b')];
  const kopia = [...flagi];
  const wynik = porzadkuj_ryzykiem(flagi);
  assert.deepEqual(flagi, kopia, 'oryginalna tablica bez zmian');
  assert.equal(wynik.length, 2, 'null odsiany');
  assert.equal(wynik[0].kolor, KOLOR_CZERWONY);
});
