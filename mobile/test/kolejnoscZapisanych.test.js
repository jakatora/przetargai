import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kolejnoscZapisanych } from '../src/lib/kolejnoscZapisanych.js';

const TERAZ = '2026-11-10T12:00:00.000Z';
const w = (id, deadline, status = 'rozwazam') => ({ id, status, tender: { id, deadline } });

test('pilne na górze: w grze od najbliższego terminu, potem złożone, bez terminu, historia', () => {
  // Serwer: od najnowszego zapisu.
  const wejscie = [
    w('minal', '2026-11-01T10:00:00.000Z'),
    w('daleki', '2026-12-20T10:00:00.000Z', 'przygotowuje'),
    w('zlozona', '2026-11-12T10:00:00.000Z', 'zlozona'),
    w('bez', null),
    w('bliski', '2026-11-13T10:00:00.000Z'),
    w('wygrana', '2026-12-01T10:00:00.000Z', 'wygrana'),
  ];
  const ids = kolejnoscZapisanych(wejscie, TERAZ).map((x) => x.id);
  assert.deepEqual(ids, ['bliski', 'daleki', 'zlozona', 'bez', 'minal', 'wygrana']);
});

test('nie zmienia wejścia; brak listy → pusta', () => {
  const wejscie = [w('b', '2026-12-01T10:00:00.000Z'), w('a', '2026-11-20T10:00:00.000Z')];
  const kopia = JSON.stringify(wejscie);
  kolejnoscZapisanych(wejscie, TERAZ);
  assert.equal(JSON.stringify(wejscie), kopia);
  assert.deepEqual(kolejnoscZapisanych(undefined, TERAZ), []);
});

test('podsumowanie nad listą: ile w grze i najbliższy termin; historia i złożone nie liczą się', async () => {
  const { podsumowanieZapisanych } = await import('../src/lib/kolejnoscZapisanych.js');
  const s = podsumowanieZapisanych([
    w('a', '2026-11-13T10:00:00.000Z'), w('b', '2026-12-20T10:00:00.000Z', 'przygotowuje'),
    w('z', '2026-11-11T10:00:00.000Z', 'zlozona'), w('m', '2026-11-01T10:00:00.000Z'),
  ], TERAZ);
  assert.deepEqual(s, { pl: '2 przetargi w grze · najbliższy termin za 3 dni', en: '2 in play · nearest deadline in 3 days', pilne: true, termin: { pl: 'najbliższy termin za 3 dni', en: 'nearest deadline in 3 days' } });
  assert.equal(podsumowanieZapisanych([w('a', '2026-11-10T20:00:00.000Z')], TERAZ).pl, '1 przetarg w grze · najbliższy termin dziś');
  assert.equal(podsumowanieZapisanych([w('a', '2026-11-11T13:00:00.000Z')], TERAZ).pl, '1 przetarg w grze · najbliższy termin jutro');
  assert.equal(podsumowanieZapisanych([w('m', '2026-11-01T10:00:00.000Z')], TERAZ), null);
  assert.equal(podsumowanieZapisanych(null, TERAZ), null);
});
