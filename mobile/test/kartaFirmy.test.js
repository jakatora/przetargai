import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KROKI_KREATORA, OPISY_BRAKOW, parsujListe, parsujKwote, kartaDoFormularza, formularzDoKarty, walidujFormularz,
} from '../src/lib/kartaFirmy.js';

test('5 kroków kreatora, każdy brak ma swój krok', () => {
  assert.deepEqual(KROKI_KREATORA.map((k) => k.nr), [1, 2, 3, 4, 5]);
  for (const kod of ['zakres', 'opis', 'wykluczenia', 'teren', 'skala', 'formalne']) {
    assert.ok(OPISY_BRAKOW[kod].krok >= 1 && OPISY_BRAKOW[kod].krok <= 5, kod);
  }
});

test('parsujListe: przecinki i nowe linie, bez duplikatów (wielkość liter), limit', () => {
  assert.deepEqual(parsujListe('dach, Dach\nrynny,  ,papa'), ['dach', 'rynny', 'papa']);
  assert.equal(parsujListe(Array(30).fill(0).map((_, i) => `s${i}`).join(','), 20).length, 20);
});

test('parsujKwote: spacje, „zł”, przecinek dziesiętny; puste → null', () => {
  assert.equal(parsujKwote('1 500 000 zł'), 1500000);
  assert.equal(parsujKwote('2000,50'), 2000);
  assert.equal(parsujKwote(''), null);
  assert.equal(parsujKwote('abc'), null);
});

test('parsujKwote: kropki i przecinki jako separatory tysięcy, „mln”/„tys.”', () => {
  assert.equal(parsujKwote('2.000.000'), 2000000);
  assert.equal(parsujKwote('800.000 zł'), 800000);
  assert.equal(parsujKwote('1.500.000,00'), 1500000);
  assert.equal(parsujKwote('1,500,000.50'), 1500000);
  assert.equal(parsujKwote('1,5 mln'), 1500000);
  assert.equal(parsujKwote('4,35 mln zł'), 4350000);
  assert.equal(parsujKwote('250 tys.'), 250000);
  assert.equal(parsujKwote('1 200 000'), 1200000);
  assert.equal(parsujKwote('12.5'), 12);
});

test('walidacja: limity pól jak na serwerze, z nazwą pola', () => {
  const ok = kartaDoFormularza({});
  assert.match(walidujFormularz({ ...ok, wykluczenia: 'drogi, x' }).pl, /Czego nie bierzesz.*„x”/);
  assert.match(walidujFormularz({ ...ok, keywords: 'a'.repeat(61) }).pl, /Słowa kluczowe/);
  assert.match(walidujFormularz({ ...ok, cpv_codes: '1'.repeat(21) }).pl, /Kody CPV/);
  assert.match(walidujFormularz({ ...ok, uprawnienia: 'B' }).pl, /Uprawnienia/);
  assert.equal(walidujFormularz({ ...ok, wykluczenia: 'drogi, mosty', keywords: 'dach', uprawnienia: 'ISO 9001' }), null);
});

test('karta ⇄ formularz w obie strony', () => {
  const karta = { company_name: 'Dachpol', opis: 'Dachy', keywords: ['dach'], cpv_codes: ['45261000'], wykluczenia: ['drogi'],
    regiony: ['18'], wartosc_min: 50000, wartosc_max: 1000000, min_dni_oferta: 7,
    formalne: { obrot_roczny: 800000, referencja_kwota: null, referencja_opis: null, uprawnienia: ['ISO 9001'] } };
  const form = kartaDoFormularza(karta);
  assert.equal(form.wykluczenia, 'drogi');
  assert.equal(form.min_dni_oferta, '7');
  const body = formularzDoKarty(form);
  assert.deepEqual(body.wykluczenia, ['drogi']);
  assert.equal(body.wartosc_max, 1000000);
  assert.deepEqual(body.formalne, { obrot_roczny: 800000, referencja_kwota: null, referencja_opis: null, uprawnienia: ['ISO 9001'] });
  assert.equal(formularzDoKarty({ ...form, company_name: 'X' }).company_name, undefined, 'za krótka nazwa nie idzie do API');
});

test('walidacja: od > do, dni poza 1–60, za długi opis', () => {
  const ok = kartaDoFormularza({});
  assert.equal(walidujFormularz(ok), null);
  assert.match(walidujFormularz({ ...ok, wartosc_min: '10', wartosc_max: '5' }).pl, /„od”/);
  assert.match(walidujFormularz({ ...ok, min_dni_oferta: '0' }).pl, /1 do 60/);
  assert.match(walidujFormularz({ ...ok, opis: 'a'.repeat(601) }).pl, /600/);
});
