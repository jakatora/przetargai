import { test } from 'node:test';
import assert from 'node:assert/strict';
import { znacznikZmian } from '../src/lib/zmianyDokumentow.js';

test('znacznik zmian w dokumentacji na karcie listy', () => {
  assert.deepEqual(znacznikZmian({ ez_zmiany: { wyjasnienia: 2, zmiany: 1, termin: 1 } }), { pl: 'Nowy termin · Zmiany SWZ (1) · Wyjaśnienia (2)', en: 'New deadline · Document changes (1) · Clarifications (2)' });
  assert.deepEqual(znacznikZmian({ ez_zmiany: { wyjasnienia: 1, zmiany: 0, termin: 0 } }).pl, 'Wyjaśnienia (1)');
  assert.equal(znacznikZmian({ ez_zmiany: { wyjasnienia: 0, zmiany: 0, termin: 0 } }), null);
  assert.equal(znacznikZmian({}), null);
  assert.equal(znacznikZmian(null), null);
});
