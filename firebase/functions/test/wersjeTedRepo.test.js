import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Wersje ogłoszenia TED na emulatorze (2026-11-01): stara wersja dostaje `zastapiony_przez` i termin aktualnej
 * (także w kopiach), katalog jej nie pokazuje, a feed ukrywa ją tylko kontu, które ma w feedzie też aktualną.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, matches, saved, evaluations } = await import('../src/db/repos.js');
const { runWersjeTed } = await import('../src/jobs/wersjeTed.js');
const { pasujeDoFiltrow, normalizujFiltry } = await import('../src/lib/katalogPrzetargow.js');
const { createApp } = await import('../src/app.js');
const { getFirestore } = await import('firebase-admin/firestore');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
let seq = 0;
async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Słowo spoza tytułu przetargu — rejestracja dopasowuje pulę wstecz i sama dodałaby obie wersje.
    body: JSON.stringify({ email: `wted-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['kanalizacja'] }),
  });
  const token = (await odp.json()).token;
  const ja = (await (await fetch(`${BAZA}/auth/me`, { headers: auth(token) })).json()).user;
  return { token, uid: ja.id };
}
const zaDni = (d) => new Date(Math.ceil((Date.now() + d * 86_400_000) / 3_600_000) * 3_600_000).toISOString();

test('stara wersja: zastąpiona, termin aktualnej w przetargu i kopiach; feed ukrywa duplikat; katalog pomija', async () => {
  // Konta PRZED przetargami: rejestracja ocenia całą pulę i zostawiłaby ślad oceny obu wersji.
  const tylkoStara = await konto();
  const obie = await konto();
  const pid = `wted-${process.pid}-${Date.now()}`;
  const nr = String(Date.now()).slice(-6);
  const wspolne = { title: 'Dostawa sprzętu laboratoryjnego', organization: 'Uniwersytet', source: 'ted', postepowanie_id: pid, cpvMain: '38000000' };
  const { tender: stara } = await tenders.upsert({ ...wspolne, externalId: `ted:${nr}1-2026`, deadline: zaDni(3), publishedAt: '2026-10-08T00:00:00+02:00' });
  const { tender: nowa } = await tenders.upsert({ ...wspolne, externalId: `ted:${nr}9-2026`, deadline: zaDni(18), publishedAt: '2026-10-30T00:00:00+01:00' });

  const { match: m1 } = await matches.create({ userId: tylkoStara.uid, tenderId: stara.id, score: 80, scorer: 'heuristic', tender: stara });
  await saved.add(tylkoStara.uid, m1);
  await saved.setReminder(tylkoStara.uid, stara.id, true);
  await matches.create({ userId: obie.uid, tenderId: stara.id, score: 80, scorer: 'heuristic', tender: stara });
  await matches.create({ userId: obie.uid, tenderId: nowa.id, score: 82, scorer: 'heuristic', tender: nowa });

  // Ślad oceny starej wersji (jak po selekcji); dopasowanie po rejestracji biegnie w tle i potrafi zdążyć ocenić
  // nową wersję — ten ślad usuwamy, żeby job musiał go przenieść.
  await evaluations.record(tylkoStara.uid, stara.id, { score: 80, scorer: 'heuristic', criteriaHash: 'h1' });
  await getFirestore().doc(`users/${tylkoStara.uid}/evaluations/${nowa.id}`).delete();
  const w = await runWersjeTed({ postepowania: [pid] });
  // Ocena i dopasowanie konta „tylkoStara” przechodzą na aktualną; „obie” ma już swoje — bez nadpisania.
  assert.deepEqual([w.z_wersjami, w.zastapione, w.kopie, w.przeniesione_oceny, w.przeniesione_dopasowania, w.ok], [1, 1, 2, 1, 1, true]);
  const s = await tenders.findById(stara.id);
  assert.deepEqual([s.zastapiony_przez, s.deadline], [nowa.id, nowa.deadline]);
  const db = getFirestore();
  assert.equal((await db.doc(`users/${tylkoStara.uid}/saved/${stara.id}`).get()).get('tender_deadline'), nowa.deadline, 'Zapisane z terminem aktualnej');
  assert.equal((await db.doc(`users/${tylkoStara.uid}/matches/${stara.id}`).get()).get('tender_zastapiony_przez'), nowa.id);

  const feed = async (t) => (await (await fetch(`${BAZA}/matches?limit=50`, { headers: auth(t.token) })).json());
  const idki = (odp) => (odp.matches ?? odp.items ?? odp).map((m) => m.tender_id ?? m.tender?.id ?? m.id);
  const f1 = idki(await feed(tylkoStara));
  assert.ok(f1.includes(nowa.id) && !f1.includes(stara.id), 'dopasowanie przeniesione na aktualną wersję');
  const przeniesione = (await db.doc(`users/${tylkoStara.uid}/matches/${nowa.id}`).get()).data();
  assert.deepEqual([przeniesione.przeniesiono_z, przeniesione.tender_deadline, przeniesione.confidence_score], [stara.id, nowa.deadline, 80]);
  assert.ok((await db.doc(`users/${tylkoStara.uid}/evaluations/${nowa.id}`).get()).exists, 'ślad oceny — selekcja nie oceni wersji drugi raz');
  assert.equal((await db.doc(`users/${obie.uid}/matches/${nowa.id}`).get()).get('confidence_score'), 82, 'istniejące dopasowanie nietknięte');
  const uObu = idki(await feed(obie));
  assert.ok(uObu.includes(nowa.id) && !uObu.includes(stara.id), 'duplikat ukryty');

  const filtry = normalizujFiltry({});
  assert.equal(pasujeDoFiltrow(s, filtry, new Date().toISOString()), false, 'katalog pomija starą wersję');
  assert.equal(pasujeDoFiltrow(await tenders.findById(nowa.id), filtry, new Date().toISOString()), true);

  const powtorka = await runWersjeTed({ postepowania: [pid] });
  assert.deepEqual([powtorka.zastapione, powtorka.przeniesione_oceny, powtorka.przeniesione_dopasowania], [0, 0, 0], 'powtórka nic nie robi');
});
