import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Informacja z otwarcia ofert dla całego rynku (2026-11-01) na emulatorze: przetarg BZP/TED tuż po terminie
 * dostaje kwotę, oferty i ceny z PDF-a; kopia w feedzie też; próby mają limit i odstęp. e-Zamówienia podmienione.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, users, matches } = await import('../src/db/repos.js');
const { runOtwarcieRynku, doProby, MAKS_PROB } = await import('../src/jobs/otwarcieRynku.js');

const ZNAK = `${process.pid}${Date.now()}`.slice(-8);
const UUID = `${ZNAK.padStart(8, '0').slice(0, 8)}-1111-2222-3333-999988887777`;
const ODCZYT = { kwota: 195457.23, kwoty_czesci: null, oferty: 6, cena_min: 158694.93, cena_max: 552963.59, czesci: false };

test('doProby: tylko e-Zamówienia, bez liczby ofert, limit prób i odstęp 16 h', () => {
  const teraz = Date.parse('2026-11-01T12:00:00Z');
  const bzp = { source: 'bzp', postepowanie_id: `ocds-148610-${UUID}` };
  assert.equal(doProby(bzp, teraz), true);
  assert.equal(doProby({ ...bzp, otwarcie_ofert: { oferty: 3 } }, teraz), false);
  assert.equal(doProby({ ...bzp, otwarcie_rynek: { proby: 1, o: '2026-11-01T02:00:00Z' } }, teraz), false);
  assert.equal(doProby({ ...bzp, otwarcie_rynek: { proby: 1, o: '2026-10-31T18:00:00Z' } }, teraz), true);
  assert.equal(doProby({ ...bzp, otwarcie_rynek: { proby: MAKS_PROB, o: '2026-10-30T00:00:00Z' } }, teraz), false);
  assert.equal(doProby({ source: 'platformazakupowa', postepowanie_id: null }, teraz), false);
  assert.equal(doProby({ source: 'ted', postepowanie_id: UUID }, teraz), true);
});

test('przetarg TED 20 h po terminie: PDF z otwarcia czytany, liczby na przetargu i w kopii; druga próba dopiero po odstępie', async () => {
  const user = await users.create({ email: `or-${ZNAK}@t.pl`, passwordHash: 'x' });
  const { tender } = await tenders.upsert({ externalId: `ted:${ZNAK}-2026`, title: 'Budowa kanalizacji', organization: 'Gmina R',
    deadline: new Date(Date.now() - 20 * 3_600_000).toISOString(), source: 'ted', postepowanie_id: UUID });
  await matches.createWithEvaluation({ userId: user.id, tenderId: tender.id, score: 77, reasoning: 'kanalizacja', tender });
  const pytane = [];
  const czytane = [];
  const opcje = {
    czekaj: async () => {},
    pobierz: async (id) => { pytane.push(id); return id === `ocds-148610-${UUID}` ? [{ id: `ocds-148610-${UUID}_7`, nazwa: 'Informacja z otwarcia ofert', rozszerzenie: 'pdf', url: 'https://ezamowienia.gov.pl/x' }] : []; },
    czytajOtwarcie: async (d) => { czytane.push(d.id); return ODCZYT; },
  };
  const w = await runOtwarcieRynku(opcje);
  assert.ok(w.ok && w.odczytane >= 1);
  assert.ok(pytane.includes(`ocds-148610-${UUID}`), 'TED pytany z przedrostkiem ocds');
  const t = await tenders.findById(tender.id);
  assert.deepEqual([t.otwarcie_ofert.oferty, t.otwarcie_ofert.kwota, t.otwarcie_rynek.proby], [6, 195457.23, 1]);
  const { getFirestore } = await import('firebase-admin/firestore');
  const kopia = (await getFirestore().collection('users').doc(user.id).collection('matches').doc(tender.id).get()).data();
  assert.deepEqual(kopia.tender_otwarcie_ofert, { kwota: 195457.23, oferty: 6, cena_min: 158694.93, cena_max: 552963.59, czesci: false });

  const ileCzytan = czytane.length;
  await runOtwarcieRynku(opcje);
  assert.equal(czytane.length, ileCzytan, 'przetarg z liczbą ofert nie jest czytany drugi raz');
});

test('bez pliku z otwarcia: próba zapisana (proby 1), kolejny przebieg w odstępie jej nie powtarza', async () => {
  const post = `ocds-148610-${String(Date.now() + 5).slice(-8)}-1111-2222-3333-666655554444`;
  const { tender } = await tenders.upsert({ externalId: `2026/BZP 33${ZNAK}/01`, title: 'Remont', organization: 'Gmina S',
    deadline: new Date(Date.now() - 10 * 3_600_000).toISOString(), source: 'bzp', postepowanie_id: post });
  const pytane = [];
  const opcje = { czekaj: async () => {}, pobierz: async (id) => { pytane.push(id); return []; }, czytajOtwarcie: async () => ODCZYT };
  await runOtwarcieRynku(opcje);
  await runOtwarcieRynku(opcje);
  assert.equal(pytane.filter((id) => id === post).length, 1);
  const t = await tenders.findById(tender.id);
  assert.equal(t.otwarcie_rynek.proby, 1);
  assert.equal(t.otwarcie_ofert ?? null, null);
});

test('403 z rzędu: po kilku błędach przebieg się kończy, bez prób zapisanych dla pominiętych', async () => {
  const { MAKS_BLEDOW_POD_RZAD } = await import('../src/jobs/otwarcieRynku.js');
  for (let i = 0; i < MAKS_BLEDOW_POD_RZAD + 3; i++) {
    await tenders.upsert({ externalId: `2026/BZP 44${ZNAK}${i}/01`, title: `Droga ${i}`, organization: 'Gmina T',
      deadline: new Date(Date.now() - (30 + i) * 3_600_000).toISOString(), source: 'bzp', postepowanie_id: `ocds-148610-${String(Date.now() + 100 + i).slice(-8)}-1111-2222-3333-${String(i).padStart(12, '0')}` });
  }
  let pytan = 0;
  const w = await runOtwarcieRynku({ czekaj: async () => {}, pobierz: async () => { pytan += 1; throw new Error('e-Zamówienia odpowiedziały 403'); }, czytajOtwarcie: async () => ODCZYT });
  assert.equal(w.przerwano, true);
  assert.equal(pytan, MAKS_BLEDOW_POD_RZAD);
  assert.equal(w.ok, true, 'dławienie platformy to nie błąd zapisu');
});

test('PDF z otwarcia: 403 przy pobraniu nie oznacza pliku jako przeczytany — kolejna próba go czyta', async () => {
  const post = `ocds-148610-${String(Date.now() + 77).slice(-8)}-1111-2222-3333-555544443333`;
  const { tender } = await tenders.upsert({ externalId: `2026/BZP 55${ZNAK}/01`, title: 'Most', organization: 'Gmina U',
    deadline: new Date(Date.now() - 30 * 3_600_000).toISOString(), source: 'bzp', postepowanie_id: post });
  const plik = { id: `${post}_3`, nazwa: 'Informacja z otwarcia ofert', rozszerzenie: 'pdf', url: 'https://ezamowienia.gov.pl/y' };
  let rzuc = true;
  const opcje = {
    czekaj: async () => {}, pobierz: async (id) => (id === post ? [plik] : []),
    czytajOtwarcie: async () => { if (rzuc) throw new Error('Pobranie SWZ: HTTP 403'); return ODCZYT; },
  };
  await runOtwarcieRynku(opcje);
  let t = await tenders.findById(tender.id);
  assert.deepEqual([t.otwarcie_ofert ?? null, t.otwarcie_rynek.proby], [null, 1]);
  rzuc = false;
  await runOtwarcieRynku({ ...opcje, teraz: Date.now() + 17 * 3_600_000 });
  t = await tenders.findById(tender.id);
  assert.deepEqual([t.otwarcie_ofert.oferty, t.otwarcie_ofert.przeczytane], [6, [plik.id]]);
});
