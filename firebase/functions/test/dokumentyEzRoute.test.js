import { test } from 'node:test';
import assert from 'node:assert/strict';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, matches } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { _ustawPobieranieDokumentowEz } = await import('../src/routes/tenders.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `${process.pid}${Date.now()}`.slice(-7);
let seq = 0;
async function konto() {
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ezdok-${ZNAK}-${++seq}@t.pl`, password: 'tajnehaslo123' }),
  });
  return odp.json();
}
const POST_ID = `ocds-148610-16f1c19e-be85-4853-82f5-${ZNAK}00001`.slice(0, 48).padEnd(48, '0');
const DOKUMENTY = [{ id: `${POST_ID}_2`, nazwa: 'Specyfikacja Warunków Zamówienia', plik: 'SWZ.pdf', rozszerzenie: 'pdf', url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${POST_ID}/${POST_ID}_2`, opublikowano: '2026-10-25T19:42:17.744Z' }];

test('POST /tenders/:id/dokumenty-ezamowienia: pobiera raz, zapisuje, drugi raz cache; bez postepowanie_id → 400; obce źródło → 400; brak → 404; bez tokenu → 401', async () => {
  const { token: t } = await konto();
  const { tender } = await tenders.upsert({ externalId: `2026/BZP ${ZNAK}/01`, title: 'Cyberbezpieczny wodociąg', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp', postepowanie_id: POST_ID, url: `https://ezamowienia.gov.pl/mp-client/search/list/${POST_ID}` });
  const wywolania = [];
  _ustawPobieranieDokumentowEz(async (id) => { wywolania.push(id); return DOKUMENTY; });
  try {
    const odp = await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/dokumenty-ezamowienia`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } });
    const tekst = await odp.text();
    assert.equal(odp.status, 200, tekst);
    const dane = JSON.parse(tekst);
    assert.equal(dane.cached, false);
    assert.equal(dane.dokumenty[0].plik, 'SWZ.pdf');
    assert.deepEqual(wywolania, [POST_ID]);
    assert.equal((await tenders.findById(tender.id)).ez_dokumenty[0].rozszerzenie, 'pdf');

    const drugi = await (await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/dokumenty-ezamowienia`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).json();
    assert.equal(drugi.cached, true);
    assert.equal(wywolania.length, 1, 'drugi raz bez sieci');

    const { tender: bezId } = await tenders.upsert({ externalId: `2026/BZP ${ZNAK}/02`, title: 'X', organization: 'Y', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp' });
    assert.equal((await fetch(`${BAZA}/tenders/${encodeURIComponent(bezId.id)}/dokumenty-ezamowienia`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).status, 400);
    const { tender: pz } = await tenders.upsert({ externalId: `pz:${ZNAK}9`, title: 'X', organization: 'Y', deadline: '2099-01-01T00:00:00.000Z', source: 'platformazakupowa', postepowanie_id: POST_ID });
    assert.equal((await fetch(`${BAZA}/tenders/${encodeURIComponent(pz.id)}/dokumenty-ezamowienia`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).status, 400);
    assert.equal((await fetch(`${BAZA}/tenders/nie-ma/dokumenty-ezamowienia`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).status, 404);
    assert.equal((await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/dokumenty-ezamowienia`, { method: 'POST' })).status, 401);
  } finally {
    _ustawPobieranieDokumentowEz(null);
  }
});

test('GET /matches/:id dla ogłoszenia BZP niesie postepowanie_id i zapisane ez_dokumenty (bez dotknięcia)', async () => {
  const { token: t, user } = await konto();
  const { tender } = await tenders.upsert({ externalId: `2026/BZP ${ZNAK}/03`, title: 'Remont dachu hali', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp', postepowanie_id: POST_ID });
  await matches.createWithEvaluation({ userId: user.id, tenderId: tender.id, score: 80, reasoning: 'dach', tender });
  const przed = await (await fetch(`${BAZA}/matches/${encodeURIComponent(tender.id)}`, { headers: { Authorization: `Bearer ${t}` } })).json();
  assert.equal(przed.match.tender.postepowanie_id, POST_ID);
  assert.equal(przed.match.tender.ez_dokumenty, null);
  await tenders.zapiszDokumentyEz(tender.id, DOKUMENTY);
  const po = await (await fetch(`${BAZA}/matches/${encodeURIComponent(tender.id)}`, { headers: { Authorization: `Bearer ${t}` } })).json();
  assert.equal(po.match.tender.ez_dokumenty[0].plik, 'SWZ.pdf');
});
