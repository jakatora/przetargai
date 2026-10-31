import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PODPOWIEDZI_PYTAN, czyMoznaPytacSwz, poprawnePytanie, opisStatusuOdpowiedzi } from '../src/lib/zapytajSwz.js';

test('pytać można tylko, gdy backend ma treść SWZ', () => {
  assert.equal(czyMoznaPytacSwz({ zrodlo: 'wklejona' }), true);
  assert.equal(czyMoznaPytacSwz({ zrodlo: 'wersja' }), true);
  assert.equal(czyMoznaPytacSwz({ zrodlo: 'brak' }), false);
  assert.equal(czyMoznaPytacSwz(null), false, 'starszy backend bez tresc_swz');
});

test('pytanie 3–500 znaków; podpowiedzi same są poprawnymi pytaniami', () => {
  assert.equal(poprawnePytanie('  a '), false);
  assert.equal(poprawnePytanie('x'.repeat(501)), false);
  for (const p of PODPOWIEDZI_PYTAN) {
    assert.ok(poprawnePytanie(p.pl) && poprawnePytanie(p.en), p.pl);
  }
});

test('status bez potwierdzonego cytatu nie wygląda na sukces', () => {
  assert.equal(opisStatusuOdpowiedzi('potwierdzone').ton, 'sukces');
  assert.equal(opisStatusuOdpowiedzi('nieudowodnione').ton, 'ostrzezenie');
  assert.equal(opisStatusuOdpowiedzi('cokolwiek').ton, 'ostrzezenie');
  assert.equal(opisStatusuOdpowiedzi('brak_w_swz').ton, 'neutralne');
});
