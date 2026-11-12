import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pilneDzis } from '../src/lib/pilneDzis.js';

const TERAZ = '2026-11-12T08:00:00.000Z';
const w = (id, deadline, status) => ({ id, status, tender: { id, title: `Przetarg ${id}`, deadline } });

test('terminy w ciągu 3 dni tylko dla ofert w grze, najbliższy pierwszy, najwyżej 3; potem alerty', () => {
  const p = pilneDzis({
    zapisane: [
      w('pojutrze', '2026-11-14T09:00:00.000Z', 'przygotowuje'), w('dzis', '2026-11-12T13:30:00.000Z'),
      w('zlozona', '2026-11-13T09:00:00.000Z', 'zlozona'), w('daleko', '2026-11-20T09:00:00.000Z'),
      w('minal', '2026-11-11T09:00:00.000Z'), w('bez', null), w('jutro', '2026-11-13T12:00:00.000Z'),
      w('czwarty', '2026-11-15T07:00:00.000Z'),
    ],
    nieprzeczytane: 3, teraz: TERAZ,
  });
  assert.deepEqual(p.map((x) => [x.klucz, x.opis.pl]), [
    ['termin-dzis', 'termin za 5 godz.'], ['termin-jutro', 'termin jutro'], ['termin-pojutrze', 'termin za 2 dni'],
    ['alerty', 'zmiany w zapisanych przetargach'],
  ]);
  assert.equal(p[3].tytul.pl, '3 nowe alerty');
  assert.equal(p[0].wpis.tender.id, 'dzis');
});

test('nic pilnego → pusta lista; odmiana alertów; termin za chwilę', () => {
  assert.deepEqual(pilneDzis({ zapisane: [w('a', '2026-12-01T09:00:00.000Z')], nieprzeczytane: 0, teraz: TERAZ }), []);
  assert.deepEqual(pilneDzis(), []);
  assert.equal(pilneDzis({ nieprzeczytane: 1, teraz: TERAZ })[0].tytul.pl, '1 nowy alert');
  assert.equal(pilneDzis({ nieprzeczytane: 12, teraz: TERAZ })[0].tytul.pl, '12 nowych alertów');
  assert.equal(pilneDzis({ zapisane: [w('z', '2026-11-12T08:40:00.000Z')], teraz: TERAZ })[0].opis.pl, 'termin za mniej niż godzinę');
});
