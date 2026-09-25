import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

/*
 * LEGACY matching PrzetargAI poza schedulerem (2026-09-25, D-031): rejestracja i PATCH
 * /auth/me z kryteriami odpalały `backfillUser` — dopasowania (z płatnym AI) na tabeli
 * `tenders`, której przy wyłączonym `tender-fetch` nikt już nie odświeża. Przy
 * LEGACY_PRZETARG_ENABLED=false onboarding matching też milczy.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-legacy-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
delete process.env.LEGACY_PRZETARG_ENABLED;

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');

let server;
let base;
before(() => {
  migrate();
  // Przetarg, który heurystyka ocenia na ~96/100 — na pewno powyżej progu dopasowania.
  db.prepare(`INSERT INTO tenders (id, bzp_external_id, title, cpv_main, deadline, fetched_at)
              VALUES ('t-kan', 'ext-kan', 'Budowa kanalizacji sanitarnej kanalizacja sanitarna',
                      '45232400-6', '2099-01-01T00:00:00.000Z', '2026-09-25T00:00:00.000Z')`).run();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${DB_FILE}${s}`, { force: true }); } catch { /* Windows */ }
  }
});

async function rejestruj(email) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'haslo12345', keywords: ['kanalizacja', 'sanitarna'], cpv_codes: ['45232400-6'] }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).user.id;
}

async function dopasowania(userId, czekajMs) {
  const koniec = Date.now() + czekajMs;
  let n = 0;
  do {
    n = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE user_id = ?').get(userId).n;
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 25));
  } while (Date.now() < koniec);
  return n;
}

test('LEGACY_PRZETARG_ENABLED=false (domyślnie): rejestracja z kryteriami NIE odpala legacy matchingu', async () => {
  assert.equal(env.LEGACY_PRZETARG_ENABLED, false);
  const uid = await rejestruj(`legacy-off-${process.pid}@t.pl`);
  assert.equal(await dopasowania(uid, 500), 0);
});

test('LEGACY_PRZETARG_ENABLED=true: onboarding matching działa jak dotąd (kontrola pozytywna)', async () => {
  env.LEGACY_PRZETARG_ENABLED = true;
  try {
    const uid = await rejestruj(`legacy-on-${process.pid}@t.pl`);
    assert.ok(await dopasowania(uid, 3000) > 0, 'przy włączonej fladze backfill tworzy dopasowanie');
  } finally {
    env.LEGACY_PRZETARG_ENABLED = false;
  }
});
