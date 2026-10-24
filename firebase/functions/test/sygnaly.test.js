import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujSygnal, dodajSygnal, przykladyDlaAi, MAKS_SYGNALOW } from '../src/lib/sygnaly.js';

const TERAZ = '2026-10-21T10:00:00.000Z';

test('zbudujSygnal liczy dni do terminu i przycina komentarz', () => {
  const s = zbudujSygnal({ typ: 'odrzucenie', tenderId: 't1', tytul: 'Remont', przyczyna: 'teren',
    komentarz: 'x'.repeat(300), termin: '2026-10-25T10:00:00.000Z', wartosc: 1000, wojewodztwo: '12', teraz: TERAZ });
  assert.equal(s.dni_do_terminu, 4);
  assert.equal(s.komentarz.length, 140);
  assert.equal(s.o, TERAZ);
});

test('dodajSygnal: najnowszy pierwszy, bez duplikatu, najwyżej 50', () => {
  let lista = [];
  for (let i = 0; i < 60; i++) lista = dodajSygnal(lista, zbudujSygnal({ typ: 'zapis', tenderId: `t${i}`, tytul: `T${i}`, teraz: TERAZ }));
  assert.equal(lista.length, MAKS_SYGNALOW);
  assert.equal(lista[0].tender_id, 't59');
  lista = dodajSygnal(lista, zbudujSygnal({ typ: 'zapis', tenderId: 't40', tytul: 'T40', teraz: TERAZ }));
  assert.equal(lista.filter((s) => s.tender_id === 't40').length, 1);
  assert.equal(lista[0].tender_id, 't40');
});

test('przykladyDlaAi: po 5 zapisanych (z przywróconymi) i odrzuconych', () => {
  let lista = [];
  for (let i = 0; i < 8; i++) lista = dodajSygnal(lista, zbudujSygnal({ typ: i % 2 ? 'zapis' : 'odrzucenie', tenderId: `t${i}`, tytul: `T${i}`, przyczyna: i % 2 ? null : 'teren', teraz: TERAZ }));
  lista = dodajSygnal(lista, zbudujSygnal({ typ: 'przywrocenie', tenderId: 'p', tytul: 'P', teraz: TERAZ }));
  const p = przykladyDlaAi(lista);
  assert.equal(p.zapisane[0], 'P');
  assert.ok(p.zapisane.length <= 5 && p.odrzucone.length <= 5);
  assert.deepEqual(p.odrzucone[0], { tytul: 'T6', przyczyna: 'teren' });
  assert.deepEqual(przykladyDlaAi(undefined), { zapisane: [], odrzucone: [] });
});
