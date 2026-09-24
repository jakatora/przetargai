import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Region ogłoszenia przychodzi z KAŻDEGO rejestru w INNYM formacie:
 *   • BZP  — kod TERYT „PL12" (pole organizationProvince),
 *   • Baza Konkurencyjności — nazwa „małopolskie" (pole voivodeship),
 *   • TED  — bywa pusty.
 * Zmierzone na fixture'ach kontraktowych (test/fixtures/bk-*.json, wynik-*.json).
 *
 * Jeden wspólny normalizator jest warunkiem tego, żeby filtr regionu w trybie
 * „Wszystkie" nie CHOWAŁ po cichu całego źródła — a dokładnie to robi normalizator
 * rozpoznający wyłącznie cyfry.
 */

const { kodWojewodztwa, nazwaWojewodztwa, WOJEWODZTWA } = await import('../src/lib/wojewodztwa.js');

test('kod TERYT z BZP („PL12") sprowadza się do dwucyfrowego kodu', () => {
  assert.equal(kodWojewodztwa('PL12'), '12');
  assert.equal(kodWojewodztwa('12'), '12');
  assert.equal(kodWojewodztwa('2'), '02');
});

test('KRYTYCZNE: nazwa z Bazy Konkurencyjności („małopolskie") też daje kod', () => {
  assert.equal(kodWojewodztwa('małopolskie'), '12');
  assert.equal(kodWojewodztwa('MAZOWIECKIE'), '14');
  assert.equal(kodWojewodztwa('Warmińsko-mazurskie'), '28');
});

test('nazwa bez diakrytyków i z innym separatorem nadal się rozpoznaje', () => {
  assert.equal(kodWojewodztwa('warminsko mazurskie'), '28');
  assert.equal(kodWojewodztwa('kujawsko-pomorskie'), '04');
  assert.equal(kodWojewodztwa('  śląskie '), '24');
});

test('nierozpoznane i puste wejście daje null, nie wyjątek', () => {
  assert.equal(kodWojewodztwa(null), null);
  assert.equal(kodWojewodztwa(''), null);
  assert.equal(kodWojewodztwa('Berlin'), null);
  assert.equal(kodWojewodztwa('PL99'), null);
  assert.equal(kodWojewodztwa(undefined), null);
});

test('nazwaWojewodztwa zwraca polską nazwę albo null', () => {
  assert.equal(nazwaWojewodztwa('PL14'), 'Mazowieckie');
  assert.equal(nazwaWojewodztwa('malopolskie'), 'Małopolskie');
  assert.equal(nazwaWojewodztwa('Berlin'), null);
});

test('katalog obejmuje wszystkie 16 województw', () => {
  assert.equal(Object.keys(WOJEWODZTWA).length, 16);
});
