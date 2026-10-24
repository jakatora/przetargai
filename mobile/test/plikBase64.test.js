import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sprawdzPlikSwz, MAKS_BAJTOW_PLIKU_SWZ } from '../src/lib/plikBase64.js';

test('sprawdzPlikSwz: PDF do 5 MB przechodzi; inne formaty i za duże pliki — czytelny błąd; brak pliku nie rzuca', () => {
  assert.deepEqual(sprawdzPlikSwz({ name: 'SWZ.pdf', mimeType: 'application/pdf', size: 1024 }), { ok: true, blad: null });
  assert.equal(sprawdzPlikSwz({ name: 'swz.PDF', size: 10 }).ok, true, 'rozszerzenie bez MIME wystarcza');
  assert.match(sprawdzPlikSwz({ name: 'swz.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }).blad, /PDF/);
  assert.match(sprawdzPlikSwz({ name: 'swz.pdf', size: MAKS_BAJTOW_PLIKU_SWZ + 1 }).blad, /5 MB/);
  assert.equal(sprawdzPlikSwz(null).ok, false);
});
