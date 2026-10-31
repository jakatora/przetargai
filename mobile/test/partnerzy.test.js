import { test } from 'node:test';
import assert from 'node:assert/strict';
import { czyPokazacPartnerow, opisZakresu } from '../src/lib/partnerzy.js';

const t = (pl) => pl;

test('karta partnerów tylko dla przetargu z kodem CPV', () => {
  assert.equal(czyPokazacPartnerow({ id: 'a', cpv: '45233120-6' }), true);
  assert.equal(czyPokazacPartnerow({ id: 'a', cpv: ['45233120-6'] }), true);
  assert.equal(czyPokazacPartnerow({ id: 'a' }), false);
  assert.equal(czyPokazacPartnerow({ cpv: '45233120-6' }), false);
});

test('opis zakresu: województwo przetargu albo cała Polska', () => {
  assert.equal(opisZakresu({ poziom: 'klasa_region', branza: 'Drogi' }, t), 'Drogi · województwo przetargu');
  assert.equal(opisZakresu({ poziom: 'dzial_region', branza: 'Roboty budowlane' }, t), 'Roboty budowlane · województwo przetargu');
  assert.equal(opisZakresu({ poziom: 'klasa_kraj', branza: 'Drogi' }, t), 'Drogi · cała Polska');
  assert.equal(opisZakresu(null, t), '');
});
