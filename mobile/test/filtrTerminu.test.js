import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filtrujStatusTerminu, czyPoTerminie, policzPoTerminie, normalizujStatusTerminu,
} from '../src/lib/filtrTerminu.js';

const TERAZ = new Date('2026-08-09T12:00:00Z').getTime();
const m = (id, deadline) => ({ id, tender: { deadline } });

const DANE = [
  m('a', '2026-08-20T10:00:00Z'), // przyszły — aktywny
  m('b', '2026-08-01T10:00:00Z'), // przeszły — po terminie
  m('c', null),                    // brak terminu — aktywny
  m('d', '2026-08-09T09:00:00Z'), // dziś rano, minął — po terminie
];

test('czyPoTerminie: przeszły=true, przyszły=false, brak=false', () => {
  assert.equal(czyPoTerminie({ deadline: '2026-08-01T10:00:00Z' }, TERAZ), true);
  assert.equal(czyPoTerminie({ deadline: '2026-08-20T10:00:00Z' }, TERAZ), false);
  assert.equal(czyPoTerminie({ deadline: null }, TERAZ), false);
});

test('filtr „aktywne" chowa przeterminowane, zostawia bez terminu', () => {
  const akt = filtrujStatusTerminu(DANE, 'aktywne', TERAZ);
  assert.deepEqual(akt.map((x) => x.id), ['a', 'c']);
});

test('filtr „poterminie" zostawia tylko przeterminowane', () => {
  const po = filtrujStatusTerminu(DANE, 'poterminie', TERAZ);
  assert.deepEqual(po.map((x) => x.id), ['b', 'd']);
});

test('policzPoTerminie liczy przeterminowane', () => {
  assert.equal(policzPoTerminie(DANE, TERAZ), 2);
});

test('normalizujStatusTerminu: nieznane → domyślne „aktywne"', () => {
  assert.equal(normalizujStatusTerminu('poterminie'), 'poterminie');
  assert.equal(normalizujStatusTerminu('cokolwiek'), 'aktywne');
  assert.equal(normalizujStatusTerminu(null), 'aktywne');
});
