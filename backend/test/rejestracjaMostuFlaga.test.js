import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

/*
 * MOST_WYMAGAJ_PODPISU=false — okno wdrożeniowe (2026-09-25). Kolejność: NAJPIERW Firebase
 * zaczyna wysyłać `X-Most-Podpis`, POTEM Railway włącza egzekwowanie. Do tego czasu
 * rejestracja konta pomostowego bez podpisu musi przechodzić (inaczej most przestaje
 * zakładać konta), ale mail na domenę techniczną i tak nie wychodzi.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-most-flaga-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.MOST_WYMAGAJ_PODPISU = 'false';
process.env.MOST_EMAIL_DOMENA = 'Most.Test.PL';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');

let server;
let base;
before(() => {
  migrate();
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

test('flaga „false" z env to naprawdę false (nie z.coerce.boolean), domena znormalizowana', () => {
  assert.equal(env.MOST_WYMAGAJ_PODPISU, false);
  assert.equal(env.MOST_EMAIL_DOMENA, 'most.test.pl');
});

test('MOST_WYMAGAJ_PODPISU=false: konto pomostowe bez podpisu → 201', async () => {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `most.u${process.pid}@most.test.pl`, password: 'haslo-mostu-123' }),
  });
  assert.equal(res.status, 201);
});
