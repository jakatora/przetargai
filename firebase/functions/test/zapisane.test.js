import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * „Zapisane przetargi" (D-049) — zakładki. Wykonawca zapisuje przetarg z feedu,
 * żeby wrócić i przygotować ofertę. Subkolekcja users/{uid}/saved/{tenderId}
 * ze zdenormalizowanymi polami (render bez JOIN-a, jak feed).
 *
 * Testujemy przez prawdziwy serwer HTTP, bo najgroźniejsze ryzyko to KOLIZJA
 * tras: GET /matches/saved musi trafić w listę zapisanych, a nie w
 * GET /matches/:id (detail dopasowania o id „saved").
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, tenders, matches } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `zap-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['test'] }),
  });
  return (await odp.json()).token;
}
function auth(token) { return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }; }

async function dopasowanie(userId, tytul) {
  seq++;
  const ext = `zap-${process.pid}-${seq}`;
  const { tender } = await tenders.upsert({ externalId: ext, title: tytul, organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'ted' });
  const { match } = await matches.create({ userId, tenderId: tender.id, score: 88, reasoning: 'pasuje', scorer: 'ai', tender });
  return match.id; // = tenderId
}

async function userId(token) {
  return (await (await fetch(`${BAZA}/auth/me`, { headers: auth(token) })).json()).user.id;
}

test('zapis → lista → idempotencja → usunięcie', async () => {
  const token = await konto();
  const id = await dopasowanie(await userId(token), 'Dostawa mebli biurowych dla urzędu');

  const zapis = await fetch(`${BAZA}/matches/${id}/save`, { method: 'PUT', headers: auth(token) });
  assert.equal(zapis.status, 200);
  const t1 = await zapis.json();
  assert.equal(t1.saved, true); assert.equal(t1.created, true);

  const lista = await (await fetch(`${BAZA}/matches/saved`, { headers: auth(token) })).json();
  assert.equal(lista.count, 1);
  assert.equal(lista.saved[0].tender.id, id);
  assert.equal(lista.saved[0].tender.source, 'ted', 'źródło zachowane do etykiety w apce');
  assert.equal(lista.saved[0].confidence_score, 88);

  // Ponowny zapis: idempotentny, nie dubluje.
  const t2 = await (await fetch(`${BAZA}/matches/${id}/save`, { method: 'PUT', headers: auth(token) })).json();
  assert.equal(t2.created, false, 'drugi zapis nie tworzy nowego wpisu');
  assert.equal((await (await fetch(`${BAZA}/matches/saved`, { headers: auth(token) })).json()).count, 1);

  const usun = await fetch(`${BAZA}/matches/${id}/save`, { method: 'DELETE', headers: auth(token) });
  assert.equal((await usun.json()).saved, false);
  assert.equal((await (await fetch(`${BAZA}/matches/saved`, { headers: auth(token) })).json()).count, 0);
});

test('KRYTYCZNE: GET /matches/saved NIE koliduje z GET /matches/:id', async () => {
  const token = await konto();
  // Bez żadnego dopasowania „saved" — trasa listy musi zwrócić pustą listę,
  // a nie 404 z detalu dopasowania o id „saved".
  const odp = await fetch(`${BAZA}/matches/saved`, { headers: auth(token) });
  assert.equal(odp.status, 200);
  const dane = await odp.json();
  assert.ok(Array.isArray(dane.saved), 'to lista, nie detal');
  assert.equal(dane.count, 0);
});

test('zapis nieistniejącego dopasowania → 404', async () => {
  const token = await konto();
  const odp = await fetch(`${BAZA}/matches/nie-ma-takiego/save`, { method: 'PUT', headers: auth(token) });
  assert.equal(odp.status, 404);
});

test('IZOLACJA: zapisane jednego usera są niewidoczne dla drugiego', async () => {
  const a = await konto();
  const id = await dopasowanie(await userId(a), 'Roboty budowlane — remont szkoły');
  await fetch(`${BAZA}/matches/${id}/save`, { method: 'PUT', headers: auth(a) });

  const b = await konto();
  const listaB = await (await fetch(`${BAZA}/matches/saved`, { headers: auth(b) })).json();
  assert.equal(listaB.count, 0, 'zapisane B są puste — subkolekcja per user');
});
