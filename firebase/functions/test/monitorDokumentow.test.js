import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Monitoring dokumentów zapisanych przetargów (2026-11-01) na emulatorze: pierwszy przebieg alarmuje
 * o plikach opublikowanych po zapisaniu, drugi z tą samą listą milczy, trzeci łapie nowy plik.
 * e-Zamówienia podmienione — bez sieci.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, saved, users, alerty, matches } = await import('../src/db/repos.js');
const { runMonitorDokumentow } = await import('../src/jobs/monitorDokumentow.js');

const ZNAK = `${process.pid}${Date.now()}`.slice(-8);
const POSTEPOWANIE = `ocds-148610-${ZNAK.padStart(8, '0').slice(0, 8)}-1111-2222-3333-444455556666`;

test('nowe wyjaśnienia → alert raz; ta sama lista → nic; nowa modyfikacja → kolejny alert; błąd platformy nie psuje przebiegu', async () => {
  const user = await users.create({ email: `md-${ZNAK}@t.pl`, passwordHash: 'x' });
  const { tender } = await tenders.upsert({ externalId: `2026/BZP 02${ZNAK}/01`, title: 'Remont dachu szkoły', organization: 'Gmina X',
    deadline: new Date(Date.now() + 5 * 86_400_000).toISOString(), source: 'bzp', postepowanie_id: POSTEPOWANIE });
  await matches.createWithEvaluation({ userId: user.id, tenderId: tender.id, score: 80, reasoning: 'dach', tender });
  const [m] = (await matches.listForUser?.(user.id)) ?? [];
  await saved.add(user.id, m ?? { tender_id: tender.id, tender_title: tender.title, tender_deadline: tender.deadline });

  let lista = [
    { id: `${POSTEPOWANIE}_1`, nazwa: 'SWZ', opublikowano: '2026-10-01T10:00:00Z' },
    { id: `${POSTEPOWANIE}_2`, nazwa: 'Wyjaśnienia treści SWZ nr 1', opublikowano: new Date(Date.now() + 60_000).toISOString() },
  ];
  const email = [];
  const opcje = () => ({ pobierz: async (id) => (id === POSTEPOWANIE ? lista : []), wyslijPush: async () => ({ sent: 1 }), wyslijEmail: async (m2) => { email.push(m2); } });
  const pierwszy = await runMonitorDokumentow(opcje());
  assert.ok(pierwszy.ok && pierwszy.sprawdzone >= 1);
  const moje = () => email.filter((m2) => m2.to === `md-${ZNAK}@t.pl`);
  assert.equal(moje().length, 1);
  assert.match(moje()[0].subject, /^Nowe dokumenty w zapisanym przetargu: Remont dachu szkoły/);
  assert.match(moje()[0].text, /wyjaśnienia treści SWZ \(1\)/);

  await runMonitorDokumentow(opcje());
  assert.equal(moje().length, 1, 'ta sama lista — bez drugiego alertu');

  lista = [...lista, { id: `${POSTEPOWANIE}_3`, nazwa: 'Modyfikacja nr 1', opublikowano: new Date().toISOString() }];
  await runMonitorDokumentow(opcje());
  assert.equal(moje().length, 2);
  assert.match(moje()[1].text, /zmianę dokumentów \(1\)/);
  const wpisy = await alerty.lista(user.id);
  assert.deepEqual(wpisy.map((a) => a.typ), ['nowe_dokumenty', 'nowe_dokumenty']);
  assert.equal((await tenders.findById(tender.id)).ez_dokumenty.length, 3, 'lista zostaje jako cache ekranu');

  const awaria = await runMonitorDokumentow({ ...opcje(), pobierz: async () => { throw new Error('e-Zamówienia 503'); } });
  assert.equal(awaria.ok, true, 'awaria platformy nie jest błędem przebiegu');
  assert.ok(awaria.bledy_platformy >= 1);
});

test('czołówka feedu (wynik ≥ 80, bez zapisu): wpis w centrum alertów, bez maila i pushu; słabe dopasowanie — nic', async () => {
  const z = `${ZNAK}b`;
  const post = `ocds-148610-${String(Date.now()).slice(-8)}-1111-2222-3333-777788889999`;
  const user = await users.create({ email: `md2-${z}@t.pl`, passwordHash: 'x' });
  const slaby = await users.create({ email: `md3-${z}@t.pl`, passwordHash: 'x' });
  const { tender } = await tenders.upsert({ externalId: `2026/BZP 03${ZNAK}/01`, title: 'Dostawa paliwa', organization: 'Gmina Y',
    deadline: new Date(Date.now() + 6 * 86_400_000).toISOString(), source: 'bzp', postepowanie_id: post });
  await matches.createWithEvaluation({ userId: user.id, tenderId: tender.id, score: 90, reasoning: 'paliwo', tender });
  await matches.createWithEvaluation({ userId: slaby.id, tenderId: tender.id, score: 55, reasoning: 'paliwo', tender });
  const email = [];
  const push = [];
  await runMonitorDokumentow({
    pobierz: async (id) => (id === post ? [{ id: `${post}_1`, nazwa: 'Odpowiedzi na pytania', opublikowano: new Date(Date.now() + 60_000).toISOString() }] : []),
    wyslijPush: async (...a) => { push.push(a); return { sent: 1 }; }, wyslijEmail: async (m) => { email.push(m); },
  });
  const wpisy = await alerty.lista(user.id);
  assert.deepEqual(wpisy.map((a) => [a.typ, a.tytul.pl]), [['nowe_dokumenty', 'Nowe dokumenty w przetargu z Twojej listy: Dostawa paliwa']]);
  assert.equal(email.filter((m) => m.to === `md2-${z}@t.pl`).length, 0, 'bez maila');
  assert.deepEqual(await alerty.lista(slaby.id), [], 'dopasowanie 55 nie jest monitorowane');
});
