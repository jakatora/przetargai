import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wygasaO, wpisIndeksu, jestAktywna, podzielNaCzesci,
  DNI_PO_TERMINIE, DNI_BEZ_TERMINU, WPISOW_NA_CZESC,
} from '../src/lib/indeksPlanow.js';

test('wygasa: termin + 60 dni; bez terminu publikacja + 365 dni; bez obu null', () => {
  assert.equal(DNI_PO_TERMINIE, 60);
  assert.equal(DNI_BEZ_TERMINU, 365);
  assert.equal(wygasaO({ terminWszczecia: '2026-11-02', opublikowano: '2026-09-24' }), '2027-01-01');
  assert.equal(wygasaO({ terminWszczecia: null, opublikowano: '2026-09-24' }), '2027-09-24');
  assert.equal(wygasaO({}), null);
});

test('aktywna do dnia wygaśnięcia włącznie', () => {
  const w = { wygasa_o: '2026-10-01' };
  assert.equal(jestAktywna(w, '2026-10-01'), true);
  assert.equal(jestAktywna(w, '2026-10-02'), false);
  assert.equal(jestAktywna({}, '2026-10-01'), false, 'bez osi czasu nie pokazujemy');
});

test('wpis indeksu nie niesie opisu ani linku (to detal, nie ranking)', () => {
  const w = wpisIndeksu({
    id: '1-2026', przedmiot: 'Drogi', cpv: ['45233140'], region: '14', opis: 'długi opis', url: 'https://x',
    terminWszczecia: '2026-11-02', opublikowano: '2026-09-24', skraca_termin: true,
  });
  assert.equal(w.opis, undefined);
  assert.equal(w.url, undefined);
  assert.equal(w.wygasa_o, '2027-01-01');
  assert.equal(w.skraca_termin, true);
  assert.ok(JSON.stringify(w).length < 400, 'wpis ma być zwarty');
});

test('podział na części zachowuje kolejność i komplet', () => {
  const lista = Array.from({ length: 2 * WPISOW_NA_CZESC + 3 }, (_, i) => i);
  const czesci = podzielNaCzesci(lista);
  assert.equal(czesci.length, 3);
  assert.deepEqual(czesci.flat(), lista);
  assert.deepEqual(podzielNaCzesci([]), []);
});
