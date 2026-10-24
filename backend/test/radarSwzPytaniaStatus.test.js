import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * `POST /postepowania/:id/pytania/status` (2026-10-24): po udostępnieniu wniosku o wyjaśnienie
 * SWZ aplikacja oznacza szkice jako „wysłane" jednym żądaniem. Pytania muszą należeć do
 * postępowania użytkownika — cudze/nieistniejące → 404 bez zmian.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-pytania-status-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz, pytaniaSwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');

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

function nowy(nazwa) {
  const u = users.create({ companyNip: null, companyName: null, email: `status-${nazwa}-${process.pid}@t.pl`, passwordHash: 'h' });
  const post = postepowaniaSwz.create({ userId: u.id, nazwa: `Postępowanie ${nazwa}`, terminSkladaniaOfert: new Date(Date.now() + 20 * 86_400_000).toISOString() });
  const p1 = pytaniaSwz.create({ postepowanieId: post.id, tresc: 'Czy dopuszczacie materiały równoważne?' });
  const p2 = pytaniaSwz.create({ postepowanieId: post.id, tresc: 'Jaki okres gwarancji?' });
  return { token: signToken(u.id), postId: post.id, pytania: [p1, p2] };
}

async function status(u, postId, cialo) {
  const res = await fetch(`${base}/api/przetarg/swz/postepowania/${postId}/pytania/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify(cialo),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('szkice → wysłane jednym żądaniem; odpowiedź niesie zaktualizowaną listę', async () => {
  const u = nowy('ok');
  const r = await status(u, u.postId, { ids: u.pytania.map((p) => String(p.id)), status: 'wyslane' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.pytania.map((p) => p.status), ['wyslane', 'wyslane']);
});

test('pytanie z cudzego postępowania → 404 i nic nie zmienione', async () => {
  const a = nowy('a');
  const b = nowy('b');
  const r = await status(a, a.postId, { ids: [String(b.pytania[0].id)], status: 'wyslane' });
  assert.equal(r.status, 404);
  assert.equal(pytaniaSwz.findById(b.pytania[0].id).status, 'szkic');
});

test('zły status albo pusta lista → 400; cudze postępowanie → 404', async () => {
  const u = nowy('walidacja');
  assert.equal((await status(u, u.postId, { ids: [String(u.pytania[0].id)], status: 'gotowe' })).status, 400);
  assert.equal((await status(u, u.postId, { ids: [], status: 'wyslane' })).status, 400);
  const inny = nowy('inny');
  assert.equal((await status(u, inny.postId, { ids: [String(inny.pytania[0].id)], status: 'wyslane' })).status, 404);
});
