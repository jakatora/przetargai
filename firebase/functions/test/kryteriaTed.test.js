import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsujKryteriaTed } from '../src/lib/kryteriaTed.js';
import { mapujOgloszenieTed } from '../src/services/ted.js';
import { skrotKryteriow } from '../src/lib/ogloszenieMeta.js';

/*
 * Kryteria oceny z TED (2026-11-01). Fixture = prawdziwe ogłoszenia z TED API v3 (Polska,
 * 27–31.10.2026, pola `award-criterion-*-lot`), wybrane tak, żeby każde pokazywało inny kłopot
 * formatu: kryteria spłaszczone z wielu części, nazwy tylko przy jakości, wagi tylko w opisie,
 * punkty zamiast procentów, różne kryteria w częściach, brak kryteriów.
 */
const F = JSON.parse(readFileSync(new URL('./fixtures/ted-kryteria.json', import.meta.url), 'utf8'));
const proste = (k) => k.lista.map((c) => [c.nazwa, c.waga, c.udzial, c.rodzaj]);

test('wiele części z tymi samymi kryteriami: jedna lista (90/10 powtórzone w każdej części)', () => {
  const k = parsujKryteriaTed(F.wieleCzesci);
  assert.ok(F.wieleCzesci['award-criterion-type-lot'].length >= 6);
  assert.deepEqual(proste(k), [['Cena', 90, 90, 'cena'], ['Warunki ubezpieczenia', 10, 10, 'umowa']]);
  assert.deepEqual([k.sposob, k.rozne_w_czesciach, k.pozacenowe], ['procentowo', false, true]);
});

test('nazwa tylko przy kryterium jakościowym — cena dostaje nazwę z typu', () => {
  assert.deepEqual(proste(parsujKryteriaTed(F.nazwyJakosci)), [['Cena', 80, 80, 'cena'], ['Doświadczenie Projektanta', 20, 20, 'doswiadczenie']]);
});

test('bez wag w BT-541: wagi z opisu („max 94 pkt”), nazwa z opisu, rodzaj nie z formułki „opis kryterium”', () => {
  const k = parsujKryteriaTed(F.wagiZOpisu);
  assert.equal(F.wagiZOpisu['award-criterion-number-lot'], undefined);
  assert.deepEqual(proste(k), [['Cena', 94, 94, 'cena'], ['Efektywność', 6, 6, 'jakosc']]);
});

test('punkty zamiast procentów i same ceny w wielu częściach', () => {
  const p = parsujKryteriaTed(F.punkty);
  assert.equal(p.sposob, 'punktowo');
  assert.deepEqual(proste(p), [['Cena', 60, 60, 'cena'], ['Termin dostawy', 40, 40, 'termin']]);
  const c = parsujKryteriaTed(F.tylkoCenaWiele);
  assert.deepEqual([proste(c), c.pozacenowe, c.rozne_w_czesciach], [[['Cena', 100, 100, 'cena']], false, false]);
});

test('różne kryteria w częściach → rozne_w_czesciach; brak kryteriów → null', () => {
  assert.equal(parsujKryteriaTed(F.rozne).rozne_w_czesciach, true);
  assert.equal(parsujKryteriaTed(F.brak), null);
  assert.equal(parsujKryteriaTed({}), null);
});

test('syntetyczne granice: bez wag po okresie typów; części o różnych wagach; suma ≠ 100 — udział z sumy jak w BZP', () => {
  const bezWag = parsujKryteriaTed({ 'award-criterion-type-lot': ['price', 'quality', 'price', 'quality'], 'award-criterion-name-lot': { pol: ['Cena', 'Termin dostawy', 'Cena', 'Termin dostawy'] } });
  assert.deepEqual(proste(bezWag), [['Cena', null, null, 'cena'], ['Termin dostawy', null, null, 'termin']]);
  const dwie = parsujKryteriaTed({ 'award-criterion-type-lot': ['price', 'quality', 'price', 'quality'], 'award-criterion-number-lot': ['60', '40', '70', '30'], 'award-criterion-number-weight-lot': ['per-exa'] });
  assert.deepEqual([dwie.lista.map((c) => c.waga), dwie.rozne_w_czesciach], [[60, 40], true]);
  const suma90 = parsujKryteriaTed({ 'award-criterion-type-lot': ['price', 'quality'], 'award-criterion-number-lot': ['60', '30'], 'award-criterion-number-weight-lot': ['per-exa'] });
  assert.deepEqual(suma90.lista.map((c) => c.udzial), [66.7, 33.3]);
  const brakWagi = parsujKryteriaTed({ 'award-criterion-type-lot': ['price', 'quality'], 'award-criterion-number-lot': ['60'] });
  assert.deepEqual(brakWagi.lista.map((c) => [c.waga, c.udzial]), [[null, null], [null, null]], 'wagi nie do każdego kryterium — bez zgadywania');
});

test('mapowanie ogłoszenia: kryteria jak z BZP, `kryterium_oceny`, skrót na kartę; opisy poza podglądem', () => {
  const t = mapujOgloszenieTed({ ...F.wieleCzesci, 'title-proc': { pol: 'Ubezpieczenie floty' } });
  assert.deepEqual([t.kryterium_oceny, t.kryteria_sposob, t.kryteria_rozne_czesci], ['cena_i_jakosc', 'procentowo', false]);
  assert.deepEqual(skrotKryteriow(t), { kryteria: [{ rodzaj: 'cena', udzial: 90 }, { rodzaj: 'umowa', udzial: 10 }], reszta: 0, rozne_w_czesciach: false });
  assert.equal(t.raw['award-criterion-description-lot'], undefined);
  assert.ok(t.raw['award-criterion-type-lot']);
  const bez = mapujOgloszenieTed({ ...F.brak, 'title-proc': { pol: 'Dostawa' } });
  assert.deepEqual([bez.kryterium_oceny, bez.kryteria, bez.kryteria_rozne_czesci], [null, null, false]);
});
