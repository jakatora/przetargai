import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Scalenie wstecz bliźniaków BZP na platformazakupowa.pl (2026-11-03): „sucho” niczego nie zapisuje; potem kopia
 * schodzi z puli, wpis BZP dostaje link kopii (raz), a kopia w feedzie klienta — znacznik, po którym lista ją chowa.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { getFirestore } = await import('firebase-admin/firestore');
const { tenders, users, matches } = await import('../src/db/repos.js');
const { scalBlizniakiPlatformy, zastapKopieDlaBzp } = await import('../src/jobs/blizniakiPlatformy.js');

const ZNAK = `${process.pid}${Date.now()}`.slice(-7);

test('sucho → same liczby; potem kopia poza pulą, link przy BZP, znacznik w feedzie; drugi przebieg nic nie dubluje', async () => {
  const termin = `2098-0${1 + (Number(ZNAK) % 9)}-1${Number(ZNAK) % 10}T09:00:00.000Z`;
  const { tender: bzp } = await tenders.upsert({ externalId: `2098/BZP 0${ZNAK}`, title: `Remont świetlicy wiejskiej w Gorzycach ${ZNAK}`, organization: 'GMINA GORZYCE', deadline: termin, source: 'bzp' });
  const { tender: kopia } = await tenders.upsert({ externalId: `pz:${ZNAK}7`, title: `RG.271.5.2098 Remont świetlicy wiejskiej w Gorzycach ${ZNAK}`, organization: 'Urząd Gminy Gorzyce', deadline: termin, source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}7` });
  const obca = (await tenders.upsert({ externalId: `pz:${ZNAK}8`, title: `Remont świetlicy wiejskiej w Gorzycach ${ZNAK}`, organization: 'Gmina Przeworsk', deadline: termin, source: 'platformazakupowa' })).tender;
  const u = await users.create({ email: `bp${ZNAK}@t.pl`, passwordHash: 'h', keywords: ['remont'] });
  await matches.utworzWybrany({ userId: u.id, tender: kopia, score: 80, punkty: ['Remont'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: false });

  const sucho = await scalBlizniakiPlatformy({ sucho: true, teraz: '2098-01-01T00:00:00.000Z' });
  assert.ok(sucho.blizniaki >= 1);
  assert.equal((await tenders.findById(kopia.id)).zastapiony_przez ?? null, null, 'sucho — bez zapisu');

  await scalBlizniakiPlatformy({ teraz: '2098-01-01T00:00:00.000Z' });
  assert.equal((await tenders.findById(kopia.id)).zastapiony_przez, bzp.id);
  assert.equal((await tenders.findById(obca.id)).zastapiony_przez ?? null, null, 'inny zamawiający — zostaje osobno');
  assert.deepEqual((await tenders.findById(bzp.id)).zrodla_alternatywne.map((z) => z.url), [kopia.url]);
  assert.equal((await getFirestore().doc(`users/${u.id}/matches/${kopia.id}`).get()).get('tender_zastapiony_przez'), bzp.id);
  // Klient miał tylko kopię — dostaje wpis BZP z polami z BZP, bez nowego powiadomienia.
  const przeniesiony = (await getFirestore().doc(`users/${u.id}/matches/${bzp.id}`).get()).data();
  assert.deepEqual([przeniesiony.tender_source, przeniesiony.tender_title, przeniesiony.tender_organization, przeniesiony.przeniesiono_z],
    ['bzp', bzp.title, 'GMINA GORZYCE', kopia.id]);
  assert.equal(przeniesiony.tender_zastapiony_przez, undefined);
  assert.deepEqual(przeniesiony.uzasadnienie, ['Remont']);

  await getFirestore().doc(`users/${u.id}/matches/${bzp.id}`).update({ status: 'przygotowanie' });
  const drugi = await scalBlizniakiPlatformy({ teraz: '2098-01-01T00:00:00.000Z' });
  assert.equal((await tenders.findById(bzp.id)).zrodla_alternatywne.length, 1, 'zastąpiona kopia nie wraca do porównania');
  assert.ok(drugi.juz_zastapione >= 1);
  assert.equal((await getFirestore().doc(`users/${u.id}/matches/${bzp.id}`).get()).get('status'), 'przygotowanie', 'drugi przebieg nie nadpisuje');
});

test('nowy wpis z okna BZP zastępuje wcześniejszą kopię z e-ProPublico (inna pisownia zamawiającego); bez terminu — nic', async () => {
  const termin = `2097-0${1 + (Number(ZNAK) % 9)}-2${Number(ZNAK) % 8}T08:00:00.000Z`;
  const { tender: kopia } = await tenders.upsert({ externalId: `epp:${ZNAK}-bl`, title: `65-PN-26 Implanty ortopedyczne ${ZNAK}`, organization: 'Szpital Miejski w Gliwicach Sp. z o.o.', deadline: termin, source: 'epropublico', url: `https://e-propublico.pl/${ZNAK}` });
  const { tender: bzp } = await tenders.upsert({ externalId: `2097/BZP 0${ZNAK}`, title: `Implanty ortopedyczne ${ZNAK}`, organization: 'SZPITAL MIEJSKI W GLIWICACH SPÓŁKA Z O.O.', deadline: termin, source: 'bzp' });
  assert.equal(await zastapKopieDlaBzp([{ id: 'x', title: 'y', organization: 'z', deadline: null }]), 0);
  const u = await users.create({ email: `bp2${ZNAK}@t.pl`, passwordHash: 'h', keywords: ['implanty'] });
  await matches.utworzWybrany({ userId: u.id, tender: kopia, score: 70, punkty: ['Implanty'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
  assert.equal(await zastapKopieDlaBzp([{ id: bzp.id, title: bzp.title, organization: bzp.organization, deadline: bzp.deadline }]), 1);
  const przeniesiony = (await getFirestore().doc(`users/${u.id}/matches/${bzp.id}`).get()).data();
  assert.deepEqual([przeniesiony.tender_source, przeniesiony.przeniesiono_z], ['bzp', kopia.id]);
  assert.equal((await getFirestore().doc(`users/${u.id}/evaluations/${bzp.id}`).get()).get('decyzja'), 'wybrany', 'ślad oceny przeniesiony — bez ponownego AI');
  assert.equal((await tenders.findById(kopia.id)).zastapiony_przez, bzp.id);
  assert.deepEqual((await tenders.findById(bzp.id)).zrodla_alternatywne.map((z) => z.source), ['epropublico']);
});

test('kopia przetargu z TED (termin z samą datą): scalona, TED dostaje godzinę z platformy — także w przeniesionym dopasowaniu', async () => {
  const doba = `2096-0${1 + (Number(ZNAK) % 9)}-1${Number(ZNAK) % 10}`;
  const koniecDoby = (await import('../src/lib/daty.js')).doUtcIso(doba);
  const { tender: ted } = await tenders.upsert({ externalId: `ted:${ZNAK}-2096`, title: `Kompleksowa dostawa paliwa gazowego dla szpitala ${ZNAK}`, organization: 'SZPITAL WOJEWÓDZKI W KOSZALINIE', deadline: koniecDoby, source: 'ted' });
  const { tender: kopia } = await tenders.upsert({ externalId: `pz:${ZNAK}9`, title: `DZP.271.64.2096 Kompleksowa dostawa paliwa gazowego dla szpitala ${ZNAK}`, organization: 'Szpital Wojewódzki im. M. Kopernika w Koszalinie', deadline: `${doba}T09:00:00.000Z`, source: 'platformazakupowa', url: `https://platformazakupowa.pl/transakcja/${ZNAK}9` });
  const u = await users.create({ email: `bp3${ZNAK}@t.pl`, passwordHash: 'h', keywords: ['paliwo'] });
  await matches.utworzWybrany({ userId: u.id, tender: kopia, score: 75, punkty: ['Paliwo'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: false });

  const w = await scalBlizniakiPlatformy({ teraz: '2096-01-01T00:00:00.000Z' });
  assert.ok(w.z_ted >= 1 && w.terminy_doprecyzowane >= 1);
  assert.equal((await tenders.findById(kopia.id)).zastapiony_przez, ted.id);
  assert.equal((await tenders.findById(ted.id)).deadline, `${doba}T09:00:00.000Z`, 'godzina z platformy zamiast końca doby');
  const przeniesiony = (await getFirestore().doc(`users/${u.id}/matches/${ted.id}`).get()).data();
  assert.deepEqual([przeniesiony.tender_source, przeniesiony.tender_deadline], ['ted', `${doba}T09:00:00.000Z`]);
});
