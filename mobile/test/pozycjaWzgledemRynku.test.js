import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pozycjaWzgledemRynku } from '../src/lib/wartosciBenchmark.js';

const RYNEK = { p25: 100000, mediana: 200000, p75: 300000, n: 120, poziom: 'kraj' };

test('cztery strefy rynku: poniżej P25 ostrzega o art. 224, do mediany = konkurencyjna, do P75 neutralna, powyżej P75 ostrzega', () => {
  assert.equal(pozycjaWzgledemRynku(80000, RYNEK).pozycja, 'ponizej_p25');
  assert.match(pozycjaWzgledemRynku(80000, RYNEK).tekst, /art\. 224/);
  const k = pozycjaWzgledemRynku(150000, RYNEK);
  assert.equal(k.pozycja, 'ponizej_mediany');
  assert.equal(k.ton, 'sukces');
  assert.equal(k.procentMediany, 75);
  assert.equal(pozycjaWzgledemRynku(250000, RYNEK).pozycja, 'powyzej_mediany');
  assert.equal(pozycjaWzgledemRynku(350000, RYNEK).pozycja, 'powyzej_p75');
  assert.equal(pozycjaWzgledemRynku(200000, RYNEK).pozycja, 'ponizej_mediany', 'równo mediana liczy się jako „do mediany"');
});

test('brak rynku, zero albo śmieci → null, nie rzuca', () => {
  assert.equal(pozycjaWzgledemRynku(100, null), null);
  assert.equal(pozycjaWzgledemRynku(0, RYNEK), null);
  assert.equal(pozycjaWzgledemRynku('abc', RYNEK), null);
  assert.equal(pozycjaWzgledemRynku(100, { mediana: 0 }), null);
});
