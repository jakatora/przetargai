import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Onboarding AI (rundy 9-10): POST /auth/suggest-profile. Klucz AI pusty (jak w
 * innych testach) → ścieżka generacji degraduje łagodnie; sprawdzamy auth,
 * walidację i łagodną degradację (nie 500).
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function token() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `sp-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['x'] }),
  });
  return (await odp.json()).token;
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

test('bez tokenu → 401', async () => {
  const odp = await fetch(`${BAZA}/auth/suggest-profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opis: 'kostka brukowa' }),
  });
  assert.equal(odp.status, 401);
});

test('pusty opis → 400', async () => {
  const t = await token();
  const odp = await fetch(`${BAZA}/auth/suggest-profile`, { method: 'POST', headers: auth(t), body: JSON.stringify({ opis: '' }) });
  assert.equal(odp.status, 400);
});

test('AI wyłączone → łagodna degradacja (keywords null + powód, nie 500)', async () => {
  const t = await token();
  const odp = await fetch(`${BAZA}/auth/suggest-profile`, { method: 'POST', headers: auth(t), body: JSON.stringify({ opis: 'układam kostkę brukową i buduję ogrodzenia' }) });
  assert.equal(odp.status, 200);
  const d = await odp.json();
  assert.equal(d.keywords, null);
  assert.equal(d.powod, 'niedostepne');
  assert.ok(d.komunikat);
});
