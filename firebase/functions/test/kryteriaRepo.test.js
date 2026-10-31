import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Kryteria oceny w bazie (2026-10-31): przetarg zapisany PRZED zmianą dostaje listę raz —
 * z dziennego pobierania (upsert, ostatnie dni) albo z trasy uzupełnienia wstecz — razem
 * z poprawionym `kryterium_oceny`. Istniejącej listy nic nie nadpisuje.
 */

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, tenderDocId, matches, saved } = await import('../src/db/repos.js');
const { getFirestore } = await import('firebase-admin/firestore');

const ZNAK = `kr${process.pid}x${Date.now()}`;
const LISTA = [{ nazwa: 'Cena', waga: 60, udzial: 60, rodzaj: 'cena' }, { nazwa: 'Czas reakcji', waga: 40, udzial: 40, rodzaj: 'reakcja' }];
const baza = (id) => ({ externalId: id, title: 'Odbiór odpadów', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp' });

test('upsert: stary dokument bez listy dostaje ją raz (z poprawionym kryterium), druga wersja nie nadpisuje', async () => {
  const id = `${ZNAK}-a`;
  await tenders.upsert({ ...baza(id), kryterium_oceny: 'tylko_cena' });
  const { tender } = await tenders.upsert({ ...baza(id), kryterium_oceny: 'cena_i_jakosc', kryteria: LISTA, kryteria_sposob: 'procentowo', kryteria_rozne_czesci: false });
  assert.deepEqual(tender.kryteria, LISTA);
  let zapis = await tenders.findById(tender.id);
  assert.deepEqual([zapis.kryterium_oceny, zapis.kryteria_sposob, zapis.kryteria.length], ['cena_i_jakosc', 'procentowo', 2]);
  await tenders.upsert({ ...baza(id), kryterium_oceny: 'tylko_cena', kryteria: [LISTA[0]], kryteria_sposob: 'punktowo' });
  zapis = await tenders.findById(tender.id);
  assert.deepEqual([zapis.kryterium_oceny, zapis.kryteria.length, zapis.kryteria_sposob], ['cena_i_jakosc', 2, 'procentowo']);
});

test('uzupelnijKryteria: tylko istniejące dokumenty bez listy; liczniki', async () => {
  const bezListy = `${ZNAK}-b`;
  const zLista = `${ZNAK}-c`;
  await tenders.upsert({ ...baza(bezListy), kryterium_oceny: 'tylko_cena' });
  await tenders.upsert({ ...baza(zLista), kryteria: [LISTA[0]], kryteria_sposob: 'punktowo' });
  const wynik = await tenders.uzupelnijKryteria([
    { externalId: bezListy, kryteria: LISTA, kryteria_sposob: 'procentowo', kryteria_rozne_czesci: true, kryterium_oceny: 'cena_i_jakosc' },
    { externalId: zLista, kryteria: LISTA, kryteria_sposob: 'procentowo' },
    { externalId: `${ZNAK}-nie-ma`, kryteria: LISTA },
    { externalId: `${ZNAK}-pusto`, kryteria: null },
  ]);
  assert.deepEqual(wynik, { z_kryteriami: 3, istniejace: 2, uzupelnione: 1 });
  const zapisB = await tenders.findById(tenderDocId(bezListy));
  assert.deepEqual([zapisB.kryterium_oceny, zapisB.kryteria_rozne_czesci, zapisB.kryteria.length], ['cena_i_jakosc', true, 2]);
  const c = await tenders.findById(tenderDocId(zLista));
  assert.deepEqual([c.kryteria.length, c.kryteria_sposob], [1, 'punktowo']);
});

test('skrót kryteriów: nowe dopasowanie i zapisane go kopiują; stare kopie uzupełnia trasa admina', async () => {
  const uid = `${ZNAK}-konto`;
  const db = getFirestore();
  await db.collection('users').doc(uid).set({ email: `${uid}@test.pl` });
  const { tender } = await tenders.upsert({ ...baza(`${ZNAK}-d`), kryteria: LISTA, kryteria_sposob: 'procentowo' });
  const { match } = await matches.create({ userId: uid, tenderId: tender.id, score: 80, scorer: 'heuristic', tender });
  const oczekiwany = { kryteria: [{ rodzaj: 'cena', udzial: 60 }, { rodzaj: 'reakcja', udzial: 40 }], reszta: 0, rozne_w_czesciach: false };
  assert.deepEqual(match.tender_kryteria_skrot, oczekiwany);
  await saved.add(uid, match);
  assert.deepEqual((await db.doc(`users/${uid}/saved/${tender.id}`).get()).get('tender_kryteria_skrot'), oczekiwany);

  // Kopia sprzed zmiany: przetarg dostał listę później (uzupełnienie wstecz), kopia nie ma skrótu.
  const { tender: stary } = await tenders.upsert({ ...baza(`${ZNAK}-e`) });
  await matches.create({ userId: uid, tenderId: stary.id, score: 70, scorer: 'heuristic', tender: stary });
  await tenders.uzupelnijKryteria([{ externalId: `${ZNAK}-e`, kryteria: LISTA, kryteria_sposob: 'procentowo' }]);
  const { tender: przeszly } = await tenders.upsert({ ...baza(`${ZNAK}-f`), deadline: '2020-01-01T00:00:00.000Z' });
  await matches.create({ userId: uid, tenderId: przeszly.id, score: 70, scorer: 'heuristic', tender: przeszly });
  await tenders.uzupelnijKryteria([{ externalId: `${ZNAK}-f`, kryteria: LISTA }]);

  const w = await matches.uzupelnijSkrotKryteriow();
  assert.ok(w.uzupelnione >= 1);
  assert.deepEqual((await db.doc(`users/${uid}/matches/${stary.id}`).get()).get('tender_kryteria_skrot'), oczekiwany);
  assert.equal((await db.doc(`users/${uid}/matches/${przeszly.id}`).get()).get('tender_kryteria_skrot'), null, 'po terminie nie ruszamy');
  const drugi = await matches.uzupelnijSkrotKryteriow();
  assert.equal((await db.doc(`users/${uid}/matches/${stary.id}`).get()).get('tender_kryteria_skrot').reszta, 0);
  assert.ok(drugi.uzupelnione <= w.uzupelnione - 1, 'powtórka nie przepisuje uzupełnionych');
});
