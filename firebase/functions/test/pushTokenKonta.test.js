import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Token push należy do TELEFONU, nie do konta (P0, 2026-09-25).
 *
 * Dwa przecieki powiadomień między kontami:
 *  1. Wylogowanie nie zdejmowało tokenu — telefon po wylogowaniu dalej dostawał
 *     powiadomienia o przetargach konta, które już na nim nie jest zalogowane.
 *  2. Konto B logujące się na tym samym telefonie rejestruje TEN SAM token Expo,
 *     ale konto A go nie traciło — właściciel A dostawał alerty na telefon B
 *     (tytuły przetargów, terminy, nazwy zamawiających cudzej firmy).
 *
 * Kontrakt: jeden token = co najwyżej jedno konto; `DELETE /auth/me/push-token`
 * zeruje token (idempotentnie), mobile woła go przy wylogowaniu.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
const unikalny = () => `${process.pid}-${++seq}-${Date.now()}`;

async function kontoRepo() {
  return users.create({ email: `pt-${unikalny()}@t.pl`, passwordHash: 'h' });
}

async function kontoHttp() {
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `pth-${unikalny()}@t.pl`, password: 'tajnehaslo123' }),
  });
  const dane = await odp.json();
  return { token: dane.token, id: dane.user.id };
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

test('ten sam token zarejestrowany przez konto B znika z konta A (ten sam telefon)', async () => {
  const a = await kontoRepo();
  const b = await kontoRepo();
  const tokenTelefonu = `ExponentPushToken[telefon-${unikalny()}]`;

  await users.setPushToken(a.id, tokenTelefonu);
  await users.setPushToken(b.id, tokenTelefonu);

  assert.equal((await users.findById(a.id)).push_token, null,
    'konto A nie może dalej dostawać powiadomień na telefon, na którym zalogowane jest B');
  assert.equal((await users.findById(b.id)).push_token, tokenTelefonu);
});

test('ponowna rejestracja tego samego tokenu przez TO SAMO konto go nie kasuje', async () => {
  const a = await kontoRepo();
  const tokenTelefonu = `ExponentPushToken[ten-sam-${unikalny()}]`;

  await users.setPushToken(a.id, tokenTelefonu);
  await users.setPushToken(a.id, tokenTelefonu);

  assert.equal((await users.findById(a.id)).push_token, tokenTelefonu);
});

test('rejestracja INNEGO tokenu nie rusza cudzych kont', async () => {
  const a = await kontoRepo();
  const b = await kontoRepo();
  const tokenA = `ExponentPushToken[a-${unikalny()}]`;
  const tokenB = `ExponentPushToken[b-${unikalny()}]`;

  await users.setPushToken(a.id, tokenA);
  await users.setPushToken(b.id, tokenB);

  assert.equal((await users.findById(a.id)).push_token, tokenA);
  assert.equal((await users.findById(b.id)).push_token, tokenB);
});

test('PUT /auth/me/push-token: token przejęty przez B zostaje zdjęty z A (end-to-end)', async () => {
  const a = await kontoHttp();
  const b = await kontoHttp();
  const tokenTelefonu = `ExponentPushToken[e2e-${unikalny()}]`;

  for (const konto of [a, b]) {
    const odp = await fetch(`${BAZA}/auth/me/push-token`, {
      method: 'PUT', headers: auth(konto.token), body: JSON.stringify({ push_token: tokenTelefonu }),
    });
    assert.equal(odp.status, 200);
  }

  assert.equal((await users.findById(a.id)).push_token, null);
  assert.equal((await users.findById(b.id)).push_token, tokenTelefonu);
});

test('DELETE /auth/me/push-token zeruje token i zwraca {ok:true}', async () => {
  const konto = await kontoHttp();
  await users.setPushToken(konto.id, `ExponentPushToken[wyloguj-${unikalny()}]`);

  const odp = await fetch(`${BAZA}/auth/me/push-token`, { method: 'DELETE', headers: auth(konto.token) });
  assert.equal(odp.status, 200);
  assert.deepEqual(await odp.json(), { ok: true });
  assert.equal((await users.findById(konto.id)).push_token, null,
    'po wylogowaniu telefon NIE może dalej dostawać powiadomień tego konta');
});

test('DELETE /auth/me/push-token jest idempotentne (brak tokenu to nie błąd)', async () => {
  const konto = await kontoHttp();

  for (let i = 0; i < 2; i++) {
    const odp = await fetch(`${BAZA}/auth/me/push-token`, { method: 'DELETE', headers: auth(konto.token) });
    assert.equal(odp.status, 200, `wywołanie ${i + 1}: wylogowanie nie może się wywracać`);
    assert.deepEqual(await odp.json(), { ok: true });
  }
  assert.equal((await users.findById(konto.id)).push_token, null);
});

test('DELETE /auth/me/push-token bez tokenu sesji → 401', async () => {
  const odp = await fetch(`${BAZA}/auth/me/push-token`, { method: 'DELETE' });
  assert.equal(odp.status, 401);
});
