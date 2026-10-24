import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const INDEX = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('index.js: pracownikCo3h co 3 h po oknach BZP/BK, strefa Warszawa, sekrety AI i maila', () => {
  const blok = INDEX.match(/export const pracownikCo3h[\s\S]*?\n\);/)?.[0] ?? '';
  assert.match(blok, /schedule: '10 2-23\/3 \* \* \*'/);
  assert.match(blok, /timeZone: 'Europe\/Warsaw'/);
  for (const s of ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY']) assert.ok(blok.includes(s), s);
});

test('rejestracja przez API daje 7 dni próby Standard', async () => {
  const odp = await fetch(`${BAZA}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `so-${process.pid}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['dach'] }) });
  assert.equal(odp.status, 201);
  const { user } = await odp.json();
  const zBazy = await users.findById(user.id);
  assert.equal(Math.round((Date.parse(zBazy.proba_do) - Date.parse(zBazy.created_at)) / 86_400_000), 7);
  assert.equal(zBazy.premium_tier, 'free', 'rozliczeniowo nadal Free');
});

test('PATCH /auth/me wyłącza maile', async () => {
  const r = await fetch(`${BAZA}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `so2-${process.pid}-${Date.now()}@t.pl`, password: 'tajnehaslo123' }) });
  const { token, user } = await r.json();
  const odp = await fetch(`${BAZA}/auth/me`, { method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ powiadomienia_pracownik_email: false }) });
  assert.equal(odp.status, 200);
  assert.equal((await users.findById(user.id)).powiadomienia_pracownik_email, false);
});
