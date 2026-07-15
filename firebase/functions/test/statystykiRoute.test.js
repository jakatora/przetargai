import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Statystyki + FOMO na Free (D-055): GET /matches/statystyki.
 * Realne liczby dopasowań + gotowa zachęta dla planu Free. Konto płatne nie
 * dostaje zachęty. Testujemy przez realny serwer HTTP.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, matches, users } = await import('../src/db/repos.js');
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
    body: JSON.stringify({ email: `sx-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['test'] }),
  });
  return (await odp.json()).token;
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const userId = async (t) => (await (await fetch(`${BAZA}/auth/me`, { headers: auth(t) })).json()).user.id;

async function dodajDopasowania(uid, ile) {
  for (let i = 0; i < ile; i++) {
    seq++;
    const { tender } = await tenders.upsert({ externalId: `sx-${process.pid}-${seq}`, title: `Przetarg ${i}`, organization: 'Gmina', source: 'bzp' });
    await matches.create({ userId: uid, tenderId: tender.id, score: 80, reasoning: 'x', scorer: 'ai', tender });
  }
}

test('Free z osiągniętym dziennym limitem → zachęta „limit”', async () => {
  const token = await konto();
  await dodajDopasowania(await userId(token), 5);

  const dane = await (await fetch(`${BAZA}/matches/statystyki`, { headers: auth(token) })).json();
  assert.equal(dane.dzis, 5);
  assert.ok(dane.w_tym_tygodniu >= 5);
  assert.equal(dane.zacheta.pokaz, true);
  assert.equal(dane.zacheta.wariant, 'limit');
  assert.match(dane.zacheta.opis, /Standard/);
});

test('konto Standard nie dostaje zachęty mimo dopasowań', async () => {
  const token = await konto();
  const uid = await userId(token);
  await dodajDopasowania(uid, 8);
  await users.setTier(uid, 'standard');

  const dane = await (await fetch(`${BAZA}/matches/statystyki`, { headers: auth(token) })).json();
  assert.equal(dane.zacheta.pokaz, false, 'płacący bez FOMO');
});

test('nowe konto Free bez aktywności → bez natrętnej zachęty', async () => {
  const token = await konto();
  const dane = await (await fetch(`${BAZA}/matches/statystyki`, { headers: auth(token) })).json();
  assert.equal(dane.dzis, 0);
  assert.equal(dane.zacheta.pokaz, false);
});
