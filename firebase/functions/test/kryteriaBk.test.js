import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { kryteriaZBk } from '../src/lib/kryteriaBk.js';
import { normalizujOgloszenieBk } from '../src/services/bazaKonkurencyjnosci.js';
import { skrotKryteriow } from '../src/lib/ogloszenieMeta.js';

/*
 * Kryteria oceny z Bazy Konkurencyjności (2026-11-01). Fixture = `evaluation_criteria` z prawdziwych
 * ogłoszeń BK (1.11.2026) w formatach, które parser musi rozróżnić: „Waga liczby punktów: 50”,
 * „/ 80 pkt /” z progami gwarancji, procent we wzorze, „waga punktowa 60”, dwie pozycje ceny bez wag.
 */
const F = JSON.parse(readFileSync(new URL('./fixtures/bk-kryteria.json', import.meta.url), 'utf8'));
const proste = (k) => k.lista.map((c) => [c.nazwa, c.waga, c.udzial, c.rodzaj]);

test('wagi z opisu w różnych formatach; nazwy bez wzorów i numeracji', () => {
  assert.deepEqual(proste(kryteriaZBk(F['293090'])), [['Cena', 50, 50, 'cena'], ['Doświadczenie', 10, 10, 'doswiadczenie'], ['Termin Dostawy', 40, 40, 'termin']]);
  assert.deepEqual(proste(kryteriaZBk(F['294707'])), [['Cena brutto', 80, 80, 'cena'], ['Okres gwarancji i wsparcia', 20, 20, 'gwarancja']]);
  assert.deepEqual(proste(kryteriaZBk(F['293876'])), [['Cena netto przedmiotu zamówienia', 60, 60, 'cena'], ['Okres gwarancji na przedmiot zamówienia', 30, 30, 'gwarancja'], ['Zielone kryterium', 10, 10, 'srodowisko']]);
  const proc = kryteriaZBk(F['293390']);
  assert.deepEqual(proc.lista.map((c) => [c.waga, c.rodzaj]), [[50, 'cena'], [25, 'gwarancja'], [25, 'termin']]);
});

test('dwie pozycje ceny bez wag: „tylko cena” bez udziałów; brak kryteriów → null', () => {
  const k = kryteriaZBk(F['292505']);
  assert.deepEqual([k.pozacenowe, k.lista.every((c) => c.rodzaj === 'cena'), k.lista.map((c) => c.udzial)], [false, true, [null, null]]);
  assert.equal(kryteriaZBk([{ evaluation_criteria: [] }]), null);
  assert.equal(kryteriaZBk(null), null);
});

test('suma ≠ 100 — wag nie zgadujemy; jedną brakującą dopełniamy do 100; flaga ceny bez nazwy „Cena”', () => {
  const zla = kryteriaZBk([{ evaluation_criteria: [{ price_criterion: true, description: 'Cena – 70 pkt' }, { price_criterion: false, description: 'Gwarancja – 20 pkt' }] }]);
  assert.deepEqual(zla.lista.map((c) => [c.waga, c.udzial]), [[null, null], [null, null]]);
  const dopelnij = kryteriaZBk([{ evaluation_criteria: [{ price_criterion: true, description: 'Cena netto za wynajem (W)\n\nW = Wn/Wa × 40 pkt' }, { price_criterion: true, description: 'Cena cateringu (C)\n\nC = Cn/Ca × 40 pkt' }, { price_criterion: false, description: 'Dodatkowa atrakcja (A)\n\nwartość poznawcza – tak/nie' }] }]);
  assert.deepEqual(dopelnij.lista.map((c) => [c.nazwa, c.waga]), [['Cena netto za wynajem', 40], ['Cena cateringu', 40], ['Dodatkowa atrakcja', 20]]);
  assert.equal(kryteriaZBk([{ evaluation_criteria: [{ price_criterion: false, description: 'Cena – 100 pkt' }] }]).lista[0].rodzaj, 'cena');
});

test('różne kryteria w zamówieniach (częściach) → rozne_w_czesciach', () => {
  const k = kryteriaZBk([
    { evaluation_criteria: [{ price_criterion: true, description: 'Cena – 100 pkt (100%)' }] },
    { evaluation_criteria: [{ price_criterion: true, description: 'Cena – 80 pkt' }, { price_criterion: false, description: 'Termin dostawy – 20 pkt' }] },
  ]);
  assert.deepEqual([k.rozne_w_czesciach, k.pozacenowe, proste(k)], [true, true, [['Cena', 100, 100, 'cena']]]);
});

test('mapowanie ogłoszenia BK: pola kryteriów jak z BZP i skrót na kartę (prawdziwe szczegóły 292028 i 292045)', () => {
  const sala = normalizujOgloszenieBk(JSON.parse(readFileSync(new URL('./fixtures/bk-szczegol-292028.json', import.meta.url), 'utf8')));
  assert.equal(sala.kryterium_oceny, 'cena_i_jakosc');
  assert.deepEqual(sala.kryteria.map((c) => c.rodzaj), ['cena', 'cena', 'dodatkowe']);
  const trzy = normalizujOgloszenieBk(JSON.parse(readFileSync(new URL('./fixtures/bk-szczegol-292045.json', import.meta.url), 'utf8')));
  assert.deepEqual([trzy.kryterium_oceny, trzy.kryteria_rozne_czesci, skrotKryteriow(trzy)], ['tylko_cena', false, { kryteria: [{ rodzaj: 'cena', udzial: 100 }], reszta: 0, rozne_w_czesciach: false }]);
});
