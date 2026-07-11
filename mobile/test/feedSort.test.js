import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SORTOWANIA, sortujDopasowania, filtrujTekst, normalizujSort,
} from '../src/lib/feedSort.js';

/*
 * Narzędzia pracy z feedem (życzenie usera 2026-07-11): wyszukiwarka + sortowanie.
 * Czysta logika — bez Reacta.
 */

const M = (id, score, deadline, title, org = '') => ({
  id, confidence_score: score,
  created_at: `2026-07-${String(id).padStart(2, '0')}T00:00:00.000Z`,
  tender: { deadline, title, organization: org },
});

const FEED = [
  M(1, 72, '2026-08-10T00:00:00.000Z', 'Remont dachu szkoły', 'Gmina Aleksandrów'),
  M(2, 95, '2026-07-15T00:00:00.000Z', 'Dostawa mebli biurowych', 'Powiat Nowy'),
  M(3, 85, null, 'Usługi sprzątania', 'Szpital Wojewódzki'),
  M(4, 88, '2026-07-12T00:00:00.000Z', 'Budowa drogi gminnej', 'Gmina Bór'),
];

const now = '2026-07-11T00:00:00.000Z';

// ---------------- sortowanie ----------------

test('trafność: malejąco po ocenie (domyślne)', () => {
  const r = sortujDopasowania(FEED, 'trafnosc', now).map((m) => m.id);
  assert.deepEqual(r, [2, 4, 3, 1]);
});

test('termin: najbliższy najpierw; bez terminu i po terminie na końcu', () => {
  const feed = [
    ...FEED,
    M(5, 60, '2020-01-01T00:00:00.000Z', 'Stary przetarg po terminie'),
  ];
  const r = sortujDopasowania(feed, 'termin', now).map((m) => m.id);
  // otwarte wg terminu: 4 (12 lip), 2 (15 lip), 1 (10 sie); potem bez terminu (3); na końcu miniony (5)
  assert.deepEqual(r, [4, 2, 1, 3, 5]);
});

test('najnowsze: malejąco po created_at', () => {
  const r = sortujDopasowania(FEED, 'najnowsze', now).map((m) => m.id);
  assert.deepEqual(r, [4, 3, 2, 1]);
});

test('sortowanie NIE mutuje wejścia', () => {
  const kopia = [...FEED];
  sortujDopasowania(FEED, 'termin', now);
  assert.deepEqual(FEED, kopia, 'oryginalna tablica bez zmian');
});

test('normalizujSort: śmieci wracają do trafności', () => {
  assert.equal(normalizujSort('termin'), 'termin');
  assert.equal(normalizujSort('cokolwiek'), 'trafnosc');
  assert.equal(normalizujSort(null), 'trafnosc');
});

test('SORTOWANIA: trzy tryby z etykietami, trafność pierwsza', () => {
  assert.equal(SORTOWANIA[0].wartosc, 'trafnosc');
  assert.deepEqual(SORTOWANIA.map((s) => s.wartosc), ['trafnosc', 'termin', 'najnowsze']);
});

// ---------------- wyszukiwarka ----------------

test('szukanie po tytule, bez wrażliwości na wielkość liter i ogonki', () => {
  assert.deepEqual(filtrujTekst(FEED, 'mebli').map((m) => m.id), [2]);
  assert.deepEqual(filtrujTekst(FEED, 'DROGI').map((m) => m.id), [4]);
  assert.deepEqual(filtrujTekst(FEED, 'sprzatanie').length, 1, 'bez „ą" trafia w „sprzątania"');
});

test('szukanie po nazwie zamawiającego', () => {
  assert.deepEqual(filtrujTekst(FEED, 'szpital').map((m) => m.id), [3]);
});

test('puste zapytanie = całość', () => {
  assert.equal(filtrujTekst(FEED, '').length, 4);
  assert.equal(filtrujTekst(FEED, '   ').length, 4);
});

test('brak trafień = pusta lista', () => {
  assert.deepEqual(filtrujTekst(FEED, 'lotnisko'), []);
});

test('REGRESJA: „meble" NIE trafia w jednoliterowe tokeny (np. „w m. Białystok")', () => {
  const feed = [
    M(1, 80, null, 'Dostawa mebli biurowych', 'Gmina'),
    M(2, 80, null, 'Budowa boksów garażowych w m. Białystok', 'Straż Graniczna'),
  ];
  assert.deepEqual(filtrujTekst(feed, 'meble').map((m) => m.id), [1],
    'tylko przetarg z „mebli”, bez fałszywego trafienia w „m.”');
});
