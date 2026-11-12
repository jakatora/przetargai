import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `legacy-register-${crypto.randomUUID()}.db`);
process.env.DATABASE_PATH = dbFile;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
delete process.env.LEGACY_REGISTRATION_ENABLED;
process.env.MOST_WYMAGAJ_PODPISU = 'true';
const { env } = await import('../src/config/env.js');
const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { users } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
let server, base;
const password = 'test-haslo-123';
before(async () => {
  migrate();
  users.create({ email: 'existing@example.test', passwordHash: await bcrypt.hash(password, 4),
    companyNip: null, companyName: null, keywords: [], cpvCodes: [] });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
});
async function post(route, email, headers = {}) {
  const response = await fetch(base + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email, password }) });
  return { status: response.status, body: await response.json() };
}
test('domyślnie rejestracja publiczna jest zamknięta, bez tworzenia konta i sondowania adresów', async () => {
  assert.equal(env.LEGACY_REGISTRATION_ENABLED, false);
  for (const email of ['new@example.test', 'existing@example.test']) {
    const r = await post('/auth/register', email);
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'LEGACY_REGISTRATION_DISABLED');
  }
  assert.equal(users.findByEmail('new@example.test'), null);
});
test('istniejący użytkownik nadal może się zalogować', async () => {
  const r = await post('/auth/login', 'existing@example.test');
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});
test('most nadal tworzy konto z prawidłowym podpisem, ponowienie daje 409 i login działa', async () => {
  const email = `most.test@${env.MOST_EMAIL_DOMENA}`;
  const signature = crypto.createHmac('sha256', env.JWT_SECRET).update(email).digest('hex');
  const headers = { 'X-Most-Podpis': signature };
  assert.equal((await post('/auth/register', email, headers)).status, 201);
  assert.equal((await post('/auth/register', email, headers)).status, 409);
  assert.equal((await post('/auth/login', email)).status, 200);
});
test('podszycie pod domenę mostu bez podpisu lub z fałszywym podpisem nie tworzy konta', async () => {
  const email = `most.forged@${env.MOST_EMAIL_DOMENA}`;
  for (const headers of [{}, { 'X-Most-Podpis': '0'.repeat(64) }]) {
    assert.equal((await post('/auth/register', email, headers)).status, 403);
  }
  assert.equal(users.findByEmail(email), null);
});
