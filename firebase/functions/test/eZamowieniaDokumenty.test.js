import { test } from 'node:test';
import assert from 'node:assert/strict';
import { czyIdPostepowania, linkPobrania, normalizujDokumenty, czySwz, pobierzDokumenty, BAZA_API } from '../src/services/eZamowieniaDokumenty.js';

const ID = 'ocds-148610-16f1c19e-be85-4853-82f5-171345acf01b';
// Odpowiedź GetTenderDocuments z sondy 26.10.2026 (skrót).
const SUROWE = [
  { objectId: `${ID}_2`, name: 'Specyfikacja Warunków Zamówienia', url: `https://ezamowienia.gov.pl/mp-client/search/tenderdocument/${ID}/${ID}_2`, tenderDocumentState: 'Published', createDate: '2026-10-25T19:28:30.566Z', fileName: 'SWZ.pdf', publishedDate: '2026-10-25T19:42:17.744Z', deleteDate: null, deleteReason: null },
  { objectId: `${ID}_1`, name: 'Załącznik Nr 1 - 10', url: 'x', tenderDocumentState: 'Published', fileName: 'Załączniki 1-10.zip', publishedDate: '2026-10-25T19:42:17.744Z', deleteDate: null },
  { objectId: `${ID}_3`, name: 'Stara wersja SWZ', tenderDocumentState: 'Published', fileName: 'SWZ_v1.pdf', publishedDate: '2026-10-20T10:00:00.000Z', deleteDate: '2026-10-25T00:00:00.000Z' },
  { objectId: `${ID}_4`, name: 'Szkic', tenderDocumentState: 'Draft', fileName: 'szkic.pdf' },
  { objectId: 'zly-id', name: 'Obcy', tenderDocumentState: 'Published', fileName: 'obcy.pdf' },
];

test('czyIdPostepowania / linkPobrania: tylko ocds-148610-<guid> i dokument <id>_<n>', () => {
  assert.equal(czyIdPostepowania(ID), true);
  assert.equal(czyIdPostepowania('2026/BZP 00321077/01'), false);
  assert.equal(czyIdPostepowania(null), false);
  assert.equal(linkPobrania(ID, `${ID}_2`), `${BAZA_API}/Tender/DownloadDocument/${ID}/${ID}_2`);
  assert.equal(linkPobrania(ID, '../../etc'), null);
  assert.equal(linkPobrania('x', `${ID}_2`), null);
});

test('normalizujDokumenty: opublikowane i nieusunięte, kształt jak załączniki platformy, kolejność po numerze', () => {
  const d = normalizujDokumenty(ID, SUROWE);
  assert.deepEqual(d.map((x) => x.id), [`${ID}_1`, `${ID}_2`]);
  assert.deepEqual(d[1], {
    id: `${ID}_2`, nazwa: 'Specyfikacja Warunków Zamówienia', plik: 'SWZ.pdf', rozszerzenie: 'pdf',
    url: `${BAZA_API}/Tender/DownloadDocument/${ID}/${ID}_2`, opublikowano: '2026-10-25T19:42:17.744Z',
  });
  assert.equal(d[0].rozszerzenie, 'zip');
  assert.deepEqual(normalizujDokumenty(ID, null), []);
  assert.deepEqual(normalizujDokumenty(ID, 'x'), []);
});

test('czySwz: PDF z SWZ/SIWZ albo „specyfikacja warunków” w nazwie lub pliku', () => {
  const d = normalizujDokumenty(ID, SUROWE);
  assert.equal(czySwz(d[1]), true);
  assert.equal(czySwz(d[0]), false, 'zip to nie SWZ');
  assert.equal(czySwz({ nazwa: 'Załącznik nr 4 do SWZ - Formularz', plik: 'zal4.docx', rozszerzenie: 'docx' }), false);
  assert.equal(czySwz({ nazwa: 'Załącznik nr 2 do SWZ - PPU', plik: 'ppu.pdf', rozszerzenie: 'pdf' }), true, 'załącznik PDF ze „SWZ” w nazwie przechodzi — mobile sortuje SWZ przed resztą');
});

test('pobierzDokumenty: właściwy adres i UA, zły id → wyjątek bez sieci, błąd HTTP → wyjątek', async () => {
  let zadanie = null;
  const d = await pobierzDokumenty(ID, { fetchFn: async (url, opcje) => { zadanie = { url, opcje }; return { ok: true, json: async () => SUROWE }; } });
  assert.equal(d.length, 2);
  assert.equal(zadanie.url, `${BAZA_API}/Search/GetTenderDocuments?tenderId=${ID}`);
  assert.match(zadanie.opcje.headers['User-Agent'], /PrzetargAI/);
  await assert.rejects(pobierzDokumenty('zly', { fetchFn: async () => { throw new Error('nie wolno'); } }), /identyfikator/);
  await assert.rejects(pobierzDokumenty(ID, { fetchFn: async () => ({ ok: false, status: 403 }) }), /403/);
  // Portal nie zna postępowania (400 „Brak postępowania o identyfikatorze…”) → pusta lista, nie błąd.
  assert.deepEqual(await pobierzDokumenty(ID, { fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ error: 'Brak postępowania o identyfikatorze id: x' }) }) }), []);
  assert.deepEqual(await pobierzDokumenty(ID, { fetchFn: async () => ({ ok: false, status: 404 }) }), []);
});
