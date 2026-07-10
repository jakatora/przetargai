import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Przełącznik planów DEMO (życzenie usera 2026-07-10: „chcę zobaczyć, jaka jest
 * różnica na danym pakiecie"). Kontrakt:
 *  1. istnieje WYŁĄCZNIE poza produkcją (montowany warunkowo w app.js) —
 *     na produkcji darmowe konto mogłoby samo nadać sobie Standard,
 *  2. zmienia premium_tier zalogowanego użytkownika (free|standard),
 *  3. od razu przelicza dopasowania, żeby różnica była WIDOCZNA w feedzie
 *     (Standard bez limitu vs Free 5/dzień), z pominięciem cooldownu backfillu,
 *  4. zła wartość planu = 400.
 *
 * .env.test ma NODE_ENV=test (≠ production) → trasa jest zamontowana.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { tenders } = await import('../src/db/repos.js');

const app = await createApp();
const serwer = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

async function zarejestruj() {
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `demo-${process.pid}-${Date.now()}@t.pl`,
      password: 'tajnehaslo123',
      keywords: ['dostawa mebli demo'],
    }),
  });
  assert.equal(odp.status, 201);
  return odp.json();
}

test('demo: przełączenie na standard zmienia plan i od razu przelicza dopasowania', async () => {
  // Pula musi mieć co dopasować — kilka przetargów pod słowa kluczowe usera.
  for (let i = 0; i < 7; i++) {
    await tenders.upsert({
      externalId: `demo-${process.pid}-${i}`,
      title: `Dostawa mebli demo — pakiet ${i}`,
      organization: 'Gmina Demo',
      deadline: '2099-01-01T00:00:00.000Z',
    });
  }
  tenders.odswiezPule();

  const { token } = await zarejestruj();

  const odp = await fetch(`${BAZA}/demo/tier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tier: 'standard' }),
  });
  assert.equal(odp.status, 200);
  const dane = await odp.json();
  assert.equal(dane.user.premium_tier, 'standard');
  assert.equal(typeof dane.matchesCreated, 'number');

  // Powrót na free — trasa działa w obie strony (do porównywania pakietów).
  const powrot = await fetch(`${BAZA}/demo/tier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tier: 'free' }),
  });
  assert.equal((await powrot.json()).user.premium_tier, 'free');
});

test('demo: bez tokenu 401, zły plan 400', async () => {
  const bezTokenu = await fetch(`${BAZA}/demo/tier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'standard' }),
  });
  assert.equal(bezTokenu.status, 401);

  const { token } = await zarejestruj();
  const zlyPlan = await fetch(`${BAZA}/demo/tier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tier: 'vip' }),
  });
  assert.equal(zlyPlan.status, 400);
});
