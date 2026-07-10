import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * RODO art. 17 na backendzie Railway. Aplikacja mobilna wciąż wskazuje na ten
 * backend, więc nowy ekran „Usunięcie konta" bez tej trasy dostawałby 404
 * (audyt 2026-07-10).
 *
 * SQLite kaskaduje po `ON DELETE CASCADE`, ale WYŁĄCZNIE gdy `PRAGMA foreign_keys`
 * jest włączona. Ten test sprawdza, że naprawdę jest — inaczej zostałyby sieroty.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-del-be-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

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
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function zaloz(email, password = 'haslo12345') {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, keywords: ['droga'] }),
  });
  return (await res.json()).token;
}

async function usun(token, password) {
  const res = await fetch(`${base}/auth/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  return res.status;
}

test('DELETE /auth/me — złe hasło odrzucone', async () => {
  const token = await zaloz(`zle-${process.pid}@t.pl`);
  // 403, nie 401 — 401 na trasie z tokenem oznacza dla apki wygasłą sesję i wylogowuje.
  assert.equal(await usun(token, 'nie-to-haslo'), 403);
});

test('DELETE /auth/me — bez tokenu odrzucone', async () => {
  const res = await fetch(`${base}/auth/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'x' }),
  });
  assert.equal(res.status, 401);
});

test('DELETE /auth/me — konto znika, token przestaje działać, e-mail wolny', async () => {
  const email = `ok-${process.pid}@t.pl`;
  const token = await zaloz(email);

  assert.equal(await usun(token, 'haslo12345'), 200);

  const po = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(po.status, 401, 'token usuniętego konta jest bezużyteczny');

  // Ten sam e-mail można zarejestrować ponownie.
  const nowy = await zaloz(email);
  assert.ok(nowy);
});

test('KRYTYCZNE: usunięcie konta kaskaduje — zero osieroconych dopasowań', async () => {
  const email = `kaskada-${process.pid}@t.pl`;
  const token = await zaloz(email);

  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  db.prepare(`INSERT INTO tenders (id, bzp_external_id, title, fetched_at)
              VALUES ('t-del', 'ext-del', 'Budowa drogi', '2026-01-01')`).run();
  db.prepare(`INSERT INTO matches (id, user_id, tender_id, confidence_score, created_at)
              VALUES ('m-del', ?, 't-del', 80, '2026-01-01')`).run(uid);
  db.prepare(`INSERT INTO feedback (id, user_id, match_id, helpful, created_at)
              VALUES ('f-del', ?, 'm-del', 1, '2026-01-01')`).run(uid);

  assert.equal(await usun(token, 'haslo12345'), 200);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(uid).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE user_id = ?').get(uid).n, 0,
    'dopasowania muszą zniknąć razem z kontem');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ?').get(uid).n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'zero sierot');

  // Przetarg NIE należy do użytkownika — musi zostać.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tenders WHERE id = 't-del'").get().n, 1);
});

test('subskrybent nie może usunąć konta na tym backendzie (nie anuluje Stripe)', async () => {
  const email = `sub-${process.pid}@t.pl`;
  const token = await zaloz(email);
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  db.prepare("UPDATE users SET premium_tier = 'standard' WHERE id = ?").run(uid);

  assert.equal(await usun(token, 'haslo12345'), 400, 'karta byłaby dalej obciążana');
});
