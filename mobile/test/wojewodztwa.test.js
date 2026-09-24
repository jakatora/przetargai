import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kodWojewodztwa, nazwaWojewodztwa, wojewodztwaObecne, filtrujWojewodztwo, WOJEWODZTWA } from '../src/lib/wojewodztwa.js';

test('kodWojewodztwa normalizuje PLxx / xx / x do 2-cyfrowego kodu', () => {
  assert.equal(kodWojewodztwa('PL14'), '14');
  assert.equal(kodWojewodztwa('14'), '14');
  assert.equal(kodWojewodztwa('PL02'), '02');
  assert.equal(kodWojewodztwa('2'), '02');
  assert.equal(kodWojewodztwa('PL99'), null, 'kod spoza mapy → null');
  assert.equal(kodWojewodztwa(''), null);
  assert.equal(kodWojewodztwa(null), null);
});

test('nazwaWojewodztwa mapuje na czytelną nazwę', () => {
  assert.equal(nazwaWojewodztwa('PL14'), 'Mazowieckie');
  assert.equal(nazwaWojewodztwa('PL24'), 'Śląskie');
  assert.equal(nazwaWojewodztwa('PL99'), null);
  assert.equal(Object.keys(WOJEWODZTWA).length, 16);
});

test('wojewodztwaObecne — unikalne kody z dopasowań, sort po nazwie', () => {
  const m = [
    { tender: { wojewodztwo: 'PL24' } }, // Śląskie
    { tender: { wojewodztwo: 'PL14' } }, // Mazowieckie
    { tender: { wojewodztwo: 'PL14' } }, // duplikat
    { tender: { wojewodztwo: null } },   // brak → pomijamy
    { tender: {} },
  ];
  assert.deepEqual(wojewodztwaObecne(m), ['14', '24'], 'Mazowieckie < Śląskie alfabetycznie');
});

test('filtrujWojewodztwo — po kodzie; pusty = wszystkie', () => {
  const m = [
    { id: 'a', tender: { wojewodztwo: 'PL14' } },
    { id: 'b', tender: { wojewodztwo: 'PL24' } },
    { id: 'c', tender: { wojewodztwo: null } },
  ];
  assert.deepEqual(filtrujWojewodztwo(m, '14').map((x) => x.id), ['a']);
  assert.equal(filtrujWojewodztwo(m, '').length, 3);
  assert.equal(filtrujWojewodztwo(m, null).length, 3);
  assert.deepEqual(filtrujWojewodztwo(null, '14'), []);
});

/*
 * Pomiar etapu 3: Baza Konkurencyjności podaje region NAZWĄ („małopolskie"),
 * a nie kodem TERYT jak BZP („PL12"). Normalizator rozpoznający wyłącznie cyfry
 * zwracał dla BK null, więc filtr województwa CHOWAŁ całe źródło — bez błędu,
 * bez śladu, po prostu mniej wyników.
 */

test('KRYTYCZNE: nazwa województwa z Bazy Konkurencyjności daje kod TERYT', () => {
  assert.equal(kodWojewodztwa('małopolskie'), '12');
  assert.equal(kodWojewodztwa('MAZOWIECKIE'), '14');
  assert.equal(kodWojewodztwa('Warmińsko-mazurskie'), '28');
  assert.equal(kodWojewodztwa('warminsko mazurskie'), '28', 'bez diakrytyków też');
});

test('nierozpoznana nazwa nadal daje null', () => {
  assert.equal(kodWojewodztwa('Berlin'), null);
  assert.equal(kodWojewodztwa('dolne'), null);
});

test('filtr regionu w feedzie obejmuje ogłoszenia BK obok BZP', () => {
  const feed = [
    { tender: { wojewodztwo: 'PL12' } },
    { tender: { wojewodztwo: 'małopolskie' } },
    { tender: { wojewodztwo: 'PL14' } },
  ];
  assert.equal(filtrujWojewodztwo(feed, '12').length, 2, 'BK i BZP w tym samym województwie');
  assert.deepEqual(wojewodztwaObecne(feed), ['12', '14'].sort((a, b) => WOJEWODZTWA[a].localeCompare(WOJEWODZTWA[b], 'pl')));
});
