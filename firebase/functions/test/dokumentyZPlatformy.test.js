import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Dokumenty z kopii na platformazakupowa.pl (2026-11-03): BZP/TED bez dokumentów z e-Zamówień, ze scaloną kopią
 * (`zrodla_alternatywne`) — załączniki kopii trafiają do `ez_dokumenty` (selekcja po wyborze, auto-SWZ, trasa apki).
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, users, matches } = await import('../src/db/repos.js');
const { idPzZAlternatywnych, czyDokumentyZKopii, dokumentyZKopiiPlatformy } = await import('../src/services/dokumentyZPlatformy.js');
const { dokumentyDoAnalizy } = await import('../src/jobs/autoAnalizaSwz.js');
const { pracujDlaUzytkownika } = await import('../src/services/pracownik.js');
const { createApp } = await import('../src/app.js');
const { _ustawPobieranieDokumentowEz, _ustawSzczegolPzKopii } = await import('../src/routes/tenders.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `${process.pid}${Date.now()}`.slice(-7);
const SZCZEGOL = { zalaczniki: [
  { nazwa: 'SWZ.pdf', url: `https://platformazakupowa.pl/file/get_new/${ZNAK}a.pdf`, rozmiar_kb: 900 },
  { nazwa: 'Formularz ofertowy.docx', url: `https://platformazakupowa.pl/file/get_new/${ZNAK}b.docx` },
  { nazwa: 'bez linku' },
] };
const ALT = [{ source: 'platformazakupowa', externalId: `pz:${ZNAK}1`, url: `https://platformazakupowa.pl/transakcja/${ZNAK}1` }];

test('idPzZAlternatywnych / czyDokumentyZKopii: tylko BZP/TED bez dokumentów e-Zamówień i z kopią PZ', () => {
  assert.equal(idPzZAlternatywnych({ zrodla_alternatywne: ALT }), `${ZNAK}1`);
  assert.equal(idPzZAlternatywnych({ zrodla_alternatywne: [{ source: 'platformazakupowa', url: 'https://platformazakupowa.pl/transakcja/77' }] }), '77', 'z adresu');
  assert.equal(idPzZAlternatywnych({ zrodla_alternatywne: [{ source: 'epropublico', externalId: 'epp:x' }] }), null);
  assert.equal(czyDokumentyZKopii({ source: 'bzp', zrodla_alternatywne: ALT }), true);
  assert.equal(czyDokumentyZKopii({ source: 'bzp', ez_dokumenty: [], zrodla_alternatywne: ALT }), true, 'pusta lista z e-Zamówień');
  assert.equal(czyDokumentyZKopii({ source: 'bzp', ez_dokumenty: [{ url: 'x' }], zrodla_alternatywne: ALT }), false);
  assert.equal(czyDokumentyZKopii({ source: 'platformazakupowa', zrodla_alternatywne: ALT }), false);
});

test('selekcja po wyborze: BZP bez identyfikatora e-Zamówień, z kopią → dokumenty z platformy zapisane; auto-SWZ je widzi', async () => {
  const u = await users.create({ email: `dzp${ZNAK}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  const user = await users.zapiszKarte(u.id, { companyName: null, keywords: ['dach'], cpvCodes: [], regiony: [], wartoscMax: null,
    karta: { opis: null, wykluczenia: [], wartosc_min: null, min_dni_oferta: 5, formalne: { obrot_roczny: null, referencja_kwota: null, referencja_opis: null, uprawnienia: [] } } });
  const { tender } = await tenders.upsert({ externalId: `2099/BZP ${ZNAK}`, title: 'Remont dachu szkoły', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp', zrodla_alternatywne: ALT });
  const pytane = [];
  const w = await pracujDlaUzytkownika(user, [{ ...tender }], { teraz: new Date().toISOString(),
    dokumentyZKopii: (t, o) => dokumentyZKopiiPlatformy(t, { ...o, szczegolPz: async (id) => { pytane.push(id); return SZCZEGOL; } }) });
  assert.equal(w.wybrane, 1);
  assert.deepEqual(pytane, [`${ZNAK}1`]);
  const po = await tenders.findById(tender.id);
  assert.deepEqual(po.ez_dokumenty.map((d) => [d.plik, d.rozszerzenie]), [['SWZ.pdf', 'pdf'], ['Formularz ofertowy.docx', 'docx']]);
  assert.equal(po.ez_dokumenty_zrodlo, 'platformazakupowa');
  assert.equal((await dokumentyDoAnalizy(po)).length, 2, 'auto-SWZ bierze zapisane, bez żądania');
  assert.equal((await dokumentyDoAnalizy({ ...tender, ez_dokumenty: [] }, { dokumentyZKopii: async () => [{ url: 'x' }] })).length, 1, 'bez zapisu — dociąga z kopii');
});

test('POST /tenders/:id/dokumenty-ezamowienia: e-Zamówienia nie znają postępowania → załączniki z kopii PZ, potem cache', async () => {
  const odp = await fetch(`${BAZA}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `dzpr${ZNAK}@t.pl`, password: 'tajnehaslo123' }) });
  const { token: t } = await odp.json();
  const POST_ID = `ocds-148610-16f1c19e-be85-4853-82f5-${ZNAK}00002`.slice(0, 48).padEnd(48, '0');
  const { tender } = await tenders.upsert({ externalId: `2099/BZP ${ZNAK}/02`, title: 'Remont dachu urzędu', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp', postepowanie_id: POST_ID, zrodla_alternatywne: ALT });
  const pytane = [];
  _ustawPobieranieDokumentowEz(async () => []);
  _ustawSzczegolPzKopii(async (id) => { pytane.push(id); return SZCZEGOL; });
  try {
    const dane = await (await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/dokumenty-ezamowienia`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).json();
    assert.deepEqual([dane.zrodlo, dane.dokumenty.length, pytane], ['platformazakupowa', 2, [`${ZNAK}1`]]);
    const drugi = await (await fetch(`${BAZA}/tenders/${encodeURIComponent(tender.id)}/dokumenty-ezamowienia`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).json();
    assert.deepEqual([drugi.cached, drugi.zrodlo, pytane.length], [true, 'platformazakupowa', 1]);
  } finally {
    _ustawPobieranieDokumentowEz(null);
    _ustawSzczegolPzKopii(null);
  }
});
