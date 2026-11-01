import { test } from 'node:test';
import assert from 'node:assert/strict';

import { porzadekPublikacji, aktualnaWersja, wersjeDoZastapienia } from '../src/lib/wersjeTed.js';

/*
 * Wersje ogłoszenia TED (2026-11-01): zmiana ogłoszenia to nowa publikacja tego samego postępowania. Przykład z prod:
 * postępowanie 01eaa93c… — ted:677150-2026 (termin 4.11) i ted:752719-2026 (po zmianie 19.11).
 */
test('kolejność publikacji: rok, potem numer w roku', () => {
  assert.ok(porzadekPublikacji('ted:752719-2026') > porzadekPublikacji('ted:677150-2026'));
  assert.ok(porzadekPublikacji('ted:1200-2027') > porzadekPublikacji('ted:999999-2026'));
  assert.equal(porzadekPublikacji('bzp~x'), 0);
});

test('aktualna = najpóźniej opublikowana; ten sam dzień → wyższy numer', () => {
  const stara = { id: 'ted:677150-2026', published_at: '2026-10-08T00:00:00+02:00', deadline: '2026-11-04T22:59:59.999Z' };
  const nowa = { id: 'ted:752719-2026', published_at: '2026-10-30T00:00:00+01:00', deadline: '2026-11-19T22:59:59.999Z' };
  assert.equal(aktualnaWersja([nowa, stara]).id, 'ted:752719-2026');
  const tegoDnia = { id: 'ted:752800-2026', published_at: '2026-10-30T00:00:00+01:00' };
  assert.equal(aktualnaWersja([tegoDnia, nowa]).id, 'ted:752800-2026');
  assert.equal(aktualnaWersja([]), null);
});

test('do zastąpienia: starsze wersje, które jeszcze nie wskazują aktualnej', () => {
  const v1 = { id: 'ted:665599-2026', published_at: '2026-10-01', zastapiony_przez: 'ted:675643-2026' };
  const v2 = { id: 'ted:675643-2026', published_at: '2026-10-08' };
  const v3 = { id: 'ted:752697-2026', published_at: '2026-10-30' };
  const { aktualna, starsze } = wersjeDoZastapienia([v1, v2, v3]);
  assert.equal(aktualna.id, 'ted:752697-2026');
  assert.deepEqual(starsze.map((d) => d.id), ['ted:665599-2026', 'ted:675643-2026'], 'v1 wskazuje v2, a aktualna jest v3 — też do poprawy');
  assert.deepEqual(wersjeDoZastapienia([{ ...v1, zastapiony_przez: v3.id }, { ...v2, zastapiony_przez: v3.id }, v3]).starsze, []);
  assert.deepEqual(wersjeDoZastapienia([v3]).starsze, []);
});
