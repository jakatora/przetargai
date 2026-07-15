import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATUSY, STATUS_DOMYSLNY, etykietaStatusu } from '../src/lib/statusPrzetargu.js';

/*
 * Lustro etapów po stronie mobile (D-053). Musi trzymać się backendu:
 * te same wartości w tej samej kolejności, inaczej UI i API rozjadą się cicho.
 */

test('etapy: te same wartości i kolejność co backend', () => {
  assert.deepEqual(STATUSY.map((s) => s.wartosc),
    ['rozwazam', 'przygotowuje', 'zlozona', 'wygrana', 'przegrana']);
});

test('STATUS_DOMYSLNY to rozwazam', () => {
  assert.equal(STATUS_DOMYSLNY, 'rozwazam');
});

test('etykietaStatusu: zwraca PL, nieznane → pierwszy etap', () => {
  assert.equal(etykietaStatusu('zlozona'), 'Oferta złożona');
  assert.equal(etykietaStatusu('kosmos'), 'Rozważam');
});
