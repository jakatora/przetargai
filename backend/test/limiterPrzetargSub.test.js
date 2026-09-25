import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Limiter `/api/przetarg/*` kluczowany po użytkowniku (P2, 2026-09-25).
 *
 * Aplikacja rozmawia z Railway przez most w Firebase Cloud Functions, więc CAŁY ruch
 * przetargowy przychodzi z kilku adresów Google. Limiter 120/min kluczowany po IP
 * wrzucał wszystkich użytkowników do jednego kubełka: jeden aktywny użytkownik (albo
 * skrypt) odcinał resztę. Teraz kluczem jest `sub` ZWERYFIKOWANEGO tokenu JWT (most
 * podpisuje go wspólnym JWT_SECRET), a bez poprawnego tokenu — adres IP.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-limiter-sub-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');

const LIMIT = 120;
let server;
let base;
let tokenA;
let tokenB;

before(() => {
  migrate();
  const nowy = (n) => users.create({ companyNip: null, companyName: null, email: `${n}-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  tokenA = signToken(nowy('lim-a'));
  tokenB = signToken(nowy('lim-b'));
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function lista(token) {
  const res = await fetch(`${base}/api/przetarg/swz/postepowania`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  await res.arrayBuffer();
  return { status: res.status, pozostalo: Number(res.headers.get('ratelimit-remaining')) };
}

test('dwa różne tokeny z tego samego IP mają osobne kubełki', async () => {
  const a1 = await lista(tokenA);
  const b1 = await lista(tokenB);
  assert.equal(a1.status, 200);
  assert.equal(b1.status, 200);
  assert.equal(a1.pozostalo, LIMIT - 1);
  assert.equal(b1.pozostalo, LIMIT - 1, 'żądanie B nie zjadło kubełka A');

  // Wyczerpanie kubełka A nie blokuje B.
  let ostatniA;
  for (let i = 1; i <= LIMIT; i++) ostatniA = await lista(tokenA);
  assert.equal(ostatniA.status, 429, 'A po wyczerpaniu limitu => 429');
  const b2 = await lista(tokenB);
  assert.equal(b2.status, 200, 'B dalej przechodzi');
  assert.equal(b2.pozostalo, LIMIT - 2);
});

test('bez tokenu albo z fałszywym tokenem kluczem jest IP (osobny kubełek od użytkowników)', async () => {
  const anon = await lista(null);
  assert.equal(anon.status, 401, 'trasa dalej wymaga logowania');
  assert.equal(anon.pozostalo, LIMIT - 1, 'anonim ma własny kubełek IP, niezależny od A');

  const falszywy = await lista(`${tokenA}zepsuty`);
  assert.equal(falszywy.status, 401);
  assert.equal(falszywy.pozostalo, LIMIT - 2, 'niezweryfikowany token liczy się do kubełka IP, nie do A');
});
