import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kwotaKrotko, czyPokazacKtoWygrywa } from '../src/lib/ktoWygrywa.js';

const t = (pl) => pl;

test('kwotaKrotko: tys./mln po polsku, brak liczby → null', () => {
  assert.equal(kwotaKrotko(1_470_000, t), '1,47 mln zł');
  assert.equal(kwotaKrotko(203_400, t), '203 tys. zł');
  assert.equal(kwotaKrotko(850, t), '850 zł');
  assert.equal(kwotaKrotko(null, t), null);
});

test('czyPokazacKtoWygrywa: tylko BZP i TED (rozstrzygnięcia mamy z tych rejestrów)', () => {
  assert.equal(czyPokazacKtoWygrywa({ id: 'x', source: 'bzp' }), true);
  assert.equal(czyPokazacKtoWygrywa({ id: 'x', zrodlo: { kod: 'ted' } }), true);
  assert.equal(czyPokazacKtoWygrywa({ id: 'x', source: 'platformazakupowa' }), false);
  assert.equal(czyPokazacKtoWygrywa({ source: 'bzp' }), false);
});
