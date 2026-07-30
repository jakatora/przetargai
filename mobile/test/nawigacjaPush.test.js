import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celPush } from '../src/lib/nawigacjaPush.js';

test('new_matches → lista MatchFeed', () => {
  const cel = celPush({ type: 'new_matches', count: 3 });
  assert.deepEqual(cel, { ekran: 'MatchFeed', params: {} });
});

test('deadline_reminder z tender_id → Saved z podświetleniem', () => {
  const cel = celPush({ type: 'deadline_reminder', tender_id: 'abc', etap: '1' });
  assert.equal(cel.ekran, 'Saved');
  assert.equal(cel.params.podswietlTenderId, 'abc');
});

test('deadline_reminder bez tender_id → Saved bez parametrów', () => {
  const cel = celPush({ type: 'deadline_reminder' });
  assert.deepEqual(cel, { ekran: 'Saved', params: {} });
});

test('tender_id liczbowe jest normalizowane do stringa', () => {
  const cel = celPush({ type: 'deadline_reminder', tender_id: 123 });
  assert.equal(cel.params.podswietlTenderId, '123');
});

test('nieznany typ → brak celu', () => {
  assert.equal(celPush({ type: 'coś_innego' }), null);
});

test('pusty/niepoprawny ładunek → brak celu (nie wywraca)', () => {
  assert.equal(celPush(null), null);
  assert.equal(celPush(undefined), null);
  assert.equal(celPush('string'), null);
  assert.equal(celPush({}), null);
});
