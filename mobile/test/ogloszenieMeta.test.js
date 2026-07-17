import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opisKryterium, opisCzesci } from '../src/lib/ogloszenieMeta.js';

test('kryterium tylko cena → jasny sygnał „walczysz ceną"', () => {
  const k = opisKryterium({ kryterium_oceny: 'tylko_cena' });
  assert.match(k.wartosc, /cena/i);
  assert.ok(k.podpis);
});

test('kryterium cena+jakość → „liczy się też jakość"', () => {
  const k = opisKryterium({ kryterium_oceny: 'cena_i_jakosc' });
  assert.match(k.wartosc, /jako/i);
});

test('nieznane kryterium → null (nie pokazujemy)', () => {
  assert.equal(opisKryterium({}), null);
  assert.equal(opisKryterium({ kryterium_oceny: null }), null);
});

test('części ≥2 → podział, plus dla małej firmy', () => {
  const c = opisCzesci({ liczba_czesci: 5 });
  assert.match(c.wartosc, /5/);
  assert.match(c.podpis, /część|części/i);
});

test('jedna część / nieznane → null (bez szumu)', () => {
  assert.equal(opisCzesci({ liczba_czesci: 1 }), null);
  assert.equal(opisCzesci({}), null);
});
