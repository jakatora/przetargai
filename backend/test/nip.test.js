import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidNip, normalizeNip } from '../src/lib/nip.js';

test('isValidNip — poprawne numery NIP', () => {
  assert.equal(isValidNip('5252248481'), true);
  assert.equal(isValidNip('525-224-84-81'), true);
  assert.equal(isValidNip('PL5252248481'), true);
  assert.equal(isValidNip(' 525 224 84 81 '), true);
});

test('isValidNip — niepoprawne numery NIP', () => {
  assert.equal(isValidNip('5252248482'), false, 'błędna suma kontrolna');
  assert.equal(isValidNip('123'), false, 'za krótki');
  assert.equal(isValidNip('12345678901'), false, 'za długi');
  assert.equal(isValidNip('abcdefghij'), false, 'nie cyfry');
  assert.equal(isValidNip(''), false);
  assert.equal(isValidNip(null), false);
  assert.equal(isValidNip(undefined), false);
});

test('normalizeNip — usuwa separatory i prefiks PL', () => {
  assert.equal(normalizeNip('525-224-84-81'), '5252248481');
  assert.equal(normalizeNip('PL 5252248481'), '5252248481');
  assert.equal(normalizeNip('  5252248481  '), '5252248481');
});
