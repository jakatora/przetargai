import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders } = await import('../src/db/repos.js');
const { runTenderFetch } = await import('../src/jobs/fetchTenders.js');

const ZNAK = `${process.pid}${Date.now()}`.slice(-7);

test('cykl dobowy: ogłoszenie z BZP zastępuje wcześniejszą kopię z platformazakupowa.pl (link poboczny + kopia poza pulą)', async () => {
  const { tender: kopia } = await tenders.upsert({ externalId: `pz:${ZNAK}1`, title: 'Remont dachu szkoły w Przeworsku', organization: 'Gmina Przeworsk', deadline: '2099-03-01T09:00:00.000Z', source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}1`, klucz_dedup: null });
  assert.ok(kopia.klucz_dedup, 'upsert liczy klucz tożsamości');
  const ogloszenieBzp = { externalId: `2099/BZP ${ZNAK}/01`, title: 'Remont dachu szkoły w Przeworsku', organization: 'Gmina Przeworsk', deadline: '2099-03-01T10:00:00.000Z', cpvMain: '45261000', source: 'bzp', url: 'https://ezamowienia.gov.pl/mp-client/x' };
  const wynik = await runTenderFetch({ zrodla: [{ nazwa: 'bzp', pobierz: async () => [ogloszenieBzp] }], alarmujAi: async () => {}, alarmujZrodla: async () => {} });
  assert.equal(wynik.zastapione_kopie_platformy, 1);
  const zBzp = await tenders.findById(`2099~BZP_${ZNAK}~01`);
  assert.ok(zBzp, 'wpis BZP zapisany');
  assert.deepEqual(zBzp.zrodla_alternatywne.map((z) => z.source), ['platformazakupowa']);
  assert.equal(zBzp.zrodla_alternatywne[0].url, kopia.url);
  const poZmianie = await tenders.findById(kopia.id);
  assert.equal(poZmianie.zastapiony_przez, zBzp.id);
  const pula = await tenders.openPool({ swiezaKopia: true });
  assert.ok(pula.some((t) => t.id === zBzp.id), 'wpis BZP w puli');
  assert.ok(!pula.some((t) => t.id === kopia.id), 'kopia platformy poza pulą');
});

test('cykl dobowy: kopia z platformy z numerem BZP i inną nazwą zamawiającego też ustępuje; kopia w feedzie dostaje znacznik', async () => {
  const { getFirestore } = await import('firebase-admin/firestore');
  const { users, matches } = await import('../src/db/repos.js');
  const nr = `0${ZNAK}`;
  const { tender: kopia } = await tenders.upsert({ externalId: `pz:${ZNAK}2`, title: `2099/BZP ${nr} (ZP.272.19.2099) Ochrona mienia bazy Referatu w Jaworze`, organization: 'Starostwo Powiatowe w Jaworze', deadline: '2099-03-02T09:00:00.000Z', source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}2` });
  const u = await users.create({ email: `czk${ZNAK}@t.pl`, passwordHash: 'h', keywords: ['ochrona'] });
  await matches.utworzWybrany({ userId: u.id, tender: kopia, score: 80, punkty: ['Ochrona'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: false });
  const ogloszenieBzp = { externalId: `2099/BZP ${nr}`, title: 'Ochrona mienia bazy Referatu w Jaworze', organization: 'POWIAT JAWORSKI', deadline: '2099-03-02T09:00:00.000Z', source: 'bzp', url: 'https://ezamowienia.gov.pl/mp-client/y' };
  const wynik = await runTenderFetch({ zrodla: [{ nazwa: 'bzp', pobierz: async () => [ogloszenieBzp] }], alarmujAi: async () => {}, alarmujZrodla: async () => {} });
  assert.equal(wynik.zastapione_kopie_platformy, 1);
  const zBzp = await tenders.findById(`2099~BZP_${nr}`);
  assert.equal((await tenders.findById(kopia.id)).zastapiony_przez, zBzp.id);
  assert.equal((await getFirestore().doc(`users/${u.id}/matches/${kopia.id}`).get()).get('tender_zastapiony_przez'), zBzp.id);
});

test('cykl dobowy: ogłoszenie TED z samą datą zastępuje kopię z platformy i dostaje z niej godzinę', async () => {
  const { tender: kopia } = await tenders.upsert({ externalId: `pz:${ZNAK}3`, title: `ZP/7/2099 Dostawa pieczywa i wyrobów cukierniczych ${ZNAK}`, organization: 'Szpital Powiatowy w Jarosławiu', deadline: '2099-03-03T07:15:00.000Z', source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}3` });
  const ogloszenieTed = { externalId: `ted:${ZNAK}-2099`, title: `Dostawa pieczywa i wyrobów cukierniczych ${ZNAK}`, organization: 'SZPITAL POWIATOWY W JAROSŁAWIU', deadline: '2099-03-03T22:59:59.999Z', source: 'ted', url: 'https://ted.europa.eu/x' };
  const wynik = await runTenderFetch({ zrodla: [{ nazwa: 'ted', pobierz: async () => [ogloszenieTed] }], alarmujAi: async () => {}, alarmujZrodla: async () => {} });
  assert.equal(wynik.zastapione_kopie_platformy, 1);
  const zTed = await tenders.findById(`ted:${ZNAK}-2099`);
  assert.equal(zTed.deadline, '2099-03-03T07:15:00.000Z', 'godzina z platformy');
  assert.equal((await tenders.findById(kopia.id)).zastapiony_przez, zTed.id);
});
