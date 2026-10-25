import { test } from 'node:test';
import assert from 'node:assert/strict';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, matches } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { _ustawPobieranieSzczegoluPz } = await import('../src/routes/tenders.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `${process.pid}${Date.now()}`.slice(-7);
let seq = 0;
async function konto() {
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `szpz-${ZNAK}-${++seq}@t.pl`, password: 'tajnehaslo123' }),
  });
  return odp.json();
}
async function token() { return (await konto()).token; }
const SZCZEGOL = { tryb: 'Tryb podstawowy', rodzaj: 'Robota budowlana', opublikowano: '2026-10-20T19:33:00.000Z', termin: '2026-11-05T09:00:00.000Z', wymagania: 'Remont dachu szkoły', zalaczniki: [{ nazwa: 'SWZ.pdf', rozszerzenie: 'pdf', rozmiar_kb: 320, opublikowano: null, url: 'https://platformazakupowa.pl/file/get_new/abc.pdf' }] };

test('POST /tenders/:id/szczegol-platformy: pobiera raz, zapisuje przy ogłoszeniu, drugi raz oddaje cache; obce źródło → 400; brak → 404', async () => {
  const t = await token();
  const { tender } = await tenders.upsert({ externalId: `pz:${ZNAK}77`, title: 'Remont dachu', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}77` });
  const wywolania = [];
  _ustawPobieranieSzczegoluPz(async (id) => { wywolania.push(id); return SZCZEGOL; });
  try {
    const odp = await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/szczegol-platformy`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.equal(dane.cached, false);
    assert.equal(dane.szczegol.tryb, 'Tryb podstawowy');
    assert.deepEqual(wywolania, [`${ZNAK}77`], 'id platformy bez prefiksu pz:');
    const zapisany = await tenders.findById(tender.id);
    assert.equal(zapisany.pz_szczegol.zalaczniki[0].nazwa, 'SWZ.pdf');

    const drugi = await (await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/szczegol-platformy`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).json();
    assert.equal(drugi.cached, true);
    assert.equal(wywolania.length, 1, 'drugi raz bez sieci');

    const { tender: bzp } = await tenders.upsert({ externalId: `bzp-${ZNAK}`, title: 'X', organization: 'Y', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp' });
    assert.equal((await fetch(`${BAZA}/tenders/${encodeURIComponent(bzp.id)}/szczegol-platformy`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).status, 400);
    assert.equal((await fetch(`${BAZA}/tenders/nie-ma/szczegol-platformy`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).status, 404);
    assert.equal((await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/szczegol-platformy`, { method: 'POST' })).status, 401);
  } finally {
    _ustawPobieranieSzczegoluPz(null);
  }
});

test('GET /matches/:id dla ogłoszenia z platformy niesie zapisany pz_szczegol (bez dotknięcia); bez szczegółu → null', async () => {
  const { token: t, user } = await konto();
  const { tender } = await tenders.upsert({ externalId: `pz:${ZNAK}88`, title: 'Remont dachu hali', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}88` });
  await matches.createWithEvaluation({ userId: user.id, tenderId: tender.id, score: 80, reasoning: 'dach', tender });
  const przed = await (await fetch(`${BAZA}/matches/${encodeURIComponent(tender.id)}`, { headers: { Authorization: `Bearer ${t}` } })).json();
  assert.equal(przed.match.tender.source, 'platformazakupowa');
  assert.equal(przed.match.tender.pz_szczegol, null);
  await tenders.zapiszSzczegolPz(tender.id, SZCZEGOL);
  const po = await (await fetch(`${BAZA}/matches/${encodeURIComponent(tender.id)}`, { headers: { Authorization: `Bearer ${t}` } })).json();
  assert.equal(po.match.tender.pz_szczegol.tryb, 'Tryb podstawowy');
  assert.equal(po.match.tender.pz_szczegol.zalaczniki[0].nazwa, 'SWZ.pdf');
});
