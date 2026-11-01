import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Unieważnienie z ogłoszenia o wyniku (2026-11-01): wynik „wszystkie części unieważnione” oznacza przetarg jako
 * anulowany (poza feedem i przypomnieniami); przetarg z większą liczbą części niż w wyniku zostaje.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, saved } = await import('../src/db/repos.js');
const { runUniewaznioneZWyniku } = await import('../src/jobs/uniewaznioneZWyniku.js');
const { getFirestore } = await import('firebase-admin/firestore');

const ZNAK = `uw${process.pid}x${Date.now()}`;
const zaDni = (d) => new Date(Math.ceil((Date.now() + d * 86_400_000) / 3_600_000) * 3_600_000).toISOString();

test('wynik z samymi unieważnieniami: przetarg anulowany, przypomnienie w Zapisanych wyłączone; części i powtórka', async () => {
  const db = getFirestore();
  const uid = `${ZNAK}-konto`;
  await db.collection('users').doc(uid).set({ email: `${uid}@test.pl` });
  const baza = { organization: 'Gmina Olszanka', source: 'bzp', deadline: zaDni(5) };
  const { tender: jeden } = await tenders.upsert({ ...baza, externalId: `${ZNAK}/1`, title: 'Kredyt długoterminowy', postepowanie_id: `ocds-${ZNAK}-1`, liczba_czesci: 1 });
  const { tender: trzyCzesci } = await tenders.upsert({ ...baza, externalId: `${ZNAK}/3`, title: 'Dostawy żywności', postepowanie_id: `ocds-${ZNAK}-3`, liczba_czesci: 3 });
  const { tender: mieszany } = await tenders.upsert({ ...baza, externalId: `${ZNAK}/m`, title: 'Remont szkoły', postepowanie_id: `ocds-${ZNAK}-m` });
  await saved.add(uid, { tender_id: jeden.id, tender_title: jeden.title, tender_deadline: jeden.deadline, tender_source: 'bzp' });
  await saved.setReminder(uid, jeden.id, true);

  const wyniki = [
    { tenderId: `ocds-${ZNAK}-1`, czesci: [{ uniewaznione: true }] },
    { tenderId: `ocds-${ZNAK}-3`, czesci: [{ uniewaznione: true }] },
    { tenderId: `ocds-${ZNAK}-m`, czesci: [{ uniewaznione: true }, { uniewaznione: false }] },
  ];
  const w = await runUniewaznioneZWyniku({ wyniki });
  assert.deepEqual([w.wynikow_uniewaznionych, w.przetargow, w.oznaczone, w.pominiete_czesci, w.ok], [2, 2, 1, 1, true]);
  assert.equal((await tenders.findById(jeden.id)).anulowany, true);
  assert.notEqual((await tenders.findById(trzyCzesci.id)).anulowany, true, 'wynik objął 1 z 3 części — zostaje');
  assert.notEqual((await tenders.findById(mieszany.id)).anulowany, true, 'część rozstrzygnięta — postępowanie trwa');
  const kopia = (await db.doc(`users/${uid}/saved/${jeden.id}`).get()).data();
  assert.deepEqual([kopia.tender_anulowany, kopia.reminder_enabled], [true, false]);

  const powtorka = await runUniewaznioneZWyniku({ wyniki });
  assert.equal(powtorka.oznaczone, 0);

  // Uzupełnianie wstecz: zapisane rozstrzygnięcia niosą `postepowanie_id`.
  const { tender: wstecz } = await tenders.upsert({ ...baza, externalId: `${ZNAK}/w`, title: 'Dostawa gazu', postepowanie_id: `ocds-${ZNAK}-w` });
  const repoWynikow = { strona: async () => ({ pozycje: [{ postepowanie_id: `ocds-${ZNAK}-w`, czesci: [{ uniewaznione: true }] }], koniec: true, kursor: null }) };
  assert.equal((await runUniewaznioneZWyniku({ repoWynikow })).oznaczone, 1);
  assert.equal((await tenders.findById(wstecz.id)).anulowany, true);
});
