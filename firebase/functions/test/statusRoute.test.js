import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Warsztat przetargu (D-053): PUT /matches/:id/status + /:id/notatka.
 * Testujemy przez realny serwer HTTP — ryzyka trasowe (kolizja z GET /:id) i
 * izolacja per user. Etap i notatka żyją na wpisie „Zapisane".
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, matches } = await import('../src/db/repos.js');
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
    body: JSON.stringify({ email: `st-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['test'] }),
  });
  return (await odp.json()).token;
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const userId = async (t) => (await (await fetch(`${BAZA}/auth/me`, { headers: auth(t) })).json()).user.id;

async function zapisany(token, tytul) {
  seq++;
  const { tender } = await tenders.upsert({ externalId: `st-${process.pid}-${seq}`, title: tytul, organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp' });
  await matches.create({ userId: await userId(token), tenderId: tender.id, score: 90, reasoning: 'x', scorer: 'ai', tender });
  await fetch(`${BAZA}/matches/${tender.id}/save`, { method: 'PUT', headers: auth(token) });
  return tender.id;
}

test('status + notatka: zapis i odczyt na liście zapisanych', async () => {
  const token = await konto();
  const id = await zapisany(token, 'Remont dachu szkoły');

  const st = await fetch(`${BAZA}/matches/${id}/status`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ status: 'przygotowuje' }) });
  assert.equal(st.status, 200);
  assert.equal((await st.json()).status, 'przygotowuje');

  const nt = await fetch(`${BAZA}/matches/${id}/notatka`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ notatka: '  zebrane: KRS, referencje  ' }) });
  assert.equal((await nt.json()).notatka, 'zebrane: KRS, referencje', 'notatka przycięta');

  const lista = await (await fetch(`${BAZA}/matches/saved`, { headers: auth(token) })).json();
  assert.equal(lista.saved[0].status, 'przygotowuje');
  assert.equal(lista.saved[0].notatka, 'zebrane: KRS, referencje');
});

test('nieznany status wraca do domyślnego „rozwazam"', async () => {
  const token = await konto();
  const id = await zapisany(token, 'Dostawa mebli');
  const st = await (await fetch(`${BAZA}/matches/${id}/status`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ status: 'kosmos' }) })).json();
  assert.equal(st.status, 'rozwazam');
});

test('etapowanie niezapisanego przetargu → 404', async () => {
  const token = await konto();
  const odp = await fetch(`${BAZA}/matches/nie-ma/status`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ status: 'wygrana' }) });
  assert.equal(odp.status, 404);
});

test('IZOLACJA: statusu cudzego przetargu nie da się ustawić', async () => {
  const a = await konto();
  const id = await zapisany(a, 'Roboty budowlane');
  const b = await konto();
  const odp = await fetch(`${BAZA}/matches/${id}/status`, { method: 'PUT', headers: auth(b), body: JSON.stringify({ status: 'wygrana' }) });
  assert.equal(odp.status, 404, 'B nie ma tego w swoich zapisanych');
});
