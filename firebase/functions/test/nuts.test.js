import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wojewodztwoRealizacji, kodWojewodztwaZNuts } from '../src/lib/nuts.js';

test('wojewodztwoRealizacji: miejsce realizacji przed siedzibą; brak jednego regionu → null; brak miejsc → siedziba', () => {
  assert.equal(wojewodztwoRealizacji({ miejsca: ['PL821'], siedziba: ['PL911'] }), '18');
  assert.equal(wojewodztwoRealizacji({ miejsca: 'PL426', siedziba: 'PL911' }), '32');
  assert.equal(wojewodztwoRealizacji({ miejsca: ['PL821', 'PL225'], siedziba: ['PL911'] }), null);
  assert.equal(wojewodztwoRealizacji({ miejsca: ['PL'], siedziba: ['PL911'] }), null);
  assert.equal(wojewodztwoRealizacji({ miejsca: ['DE21'], siedziba: ['PL911'] }), null);
  assert.equal(wojewodztwoRealizacji({ miejsca: [], siedziba: ['PL911'] }), '14');
  assert.equal(wojewodztwoRealizacji({ miejsca: [null, ''], siedziba: 'PL22A' }), '24');
  assert.equal(wojewodztwoRealizacji({}), null);
  assert.equal(kodWojewodztwaZNuts('PL821'), '18');
});
