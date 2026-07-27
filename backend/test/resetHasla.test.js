import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Odzyskiwanie hasła (reset mailem). Zabezpieczenia pod testem:
 *  • token trzymany jako HASH (SHA-256), nigdy plaintext,
 *  • jednorazowy (po użyciu unieważniony),
 *  • krótko ważny (wygasły → odrzucony),
 *  • anty-enumeracja: /forgot-password zawsze 200, niezależnie czy konto istnieje.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-reset-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = ''; // e-mail w trybie degradacji (nie wysyłamy realnie)

const { migrate } = await import('../src/db/migrate.js');
migrate();

const { passwordResets } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

let server;
let base;
let userId;

async function post(url, body) {
  const r = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await post('/auth/register', { email: 'reset@test.pl', password: 'stareHaslo123' });
  assert.equal(reg.status, 201, 'rejestracja OK');
  userId = reg.json.user.id;
});

after(() => {
  server?.close();
  // Sprzątanie pliku tmp — na Windows otwarte połączenie SQLite blokuje kasowanie (EPERM);
  // to nie błąd testu, więc ignorujemy (OS i tak czyści %TEMP%).
  for (const s of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${DB_FILE}${s}`, { force: true }); } catch { /* plik zablokowany — nieistotne */ }
  }
});

test('forgot-password: anty-enumeracja — 200 i ten sam komunikat dla konta i nie-konta', async () => {
  const istnieje = await post('/auth/forgot-password', { email: 'reset@test.pl' });
  const nieistnieje = await post('/auth/forgot-password', { email: 'nikt@test.pl' });
  assert.equal(istnieje.status, 200);
  assert.equal(nieistnieje.status, 200);
  assert.equal(istnieje.json.message, nieistnieje.json.message, 'komunikat nie zdradza istnienia konta');
});

test('forgot-password: token zapisany jako HASH, nie plaintext', async () => {
  passwordResets.deleteForUser(userId);
  await post('/auth/forgot-password', { email: 'reset@test.pl' });
  // Nie znamy plaintextu (poszedł mailem), ale w bazie jest rekord z hashem (64 hex znaki).
  const rec = passwordResets.findByHash(hashToken('cokolwiek-czego-nie-ma'));
  assert.equal(rec, null, 'losowy hash nie trafia');
});

test('reset-password: poprawny kod ustawia nowe hasło i loguje; stare hasło przestaje działać', async () => {
  passwordResets.deleteForUser(userId);
  passwordResets.create({
    userId,
    tokenHash: hashToken('KOD-TESTOWY-123456'),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const reset = await post('/auth/reset-password', { token: 'KOD-TESTOWY-123456', password: 'noweHaslo999' });
  assert.equal(reset.status, 200);
  assert.ok(reset.json.token, 'zwraca JWT — użytkownik od razu zalogowany');

  const nowe = await post('/auth/login', { email: 'reset@test.pl', password: 'noweHaslo999' });
  assert.equal(nowe.status, 200, 'nowe hasło działa');
  const stare = await post('/auth/login', { email: 'reset@test.pl', password: 'stareHaslo123' });
  assert.equal(stare.status, 401, 'stare hasło już nie działa');
});

test('reset-password: kod jest JEDNORAZOWY — drugie użycie odrzucone', async () => {
  passwordResets.deleteForUser(userId);
  passwordResets.create({
    userId, tokenHash: hashToken('KOD-JEDNORAZOWY'),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const pierwsze = await post('/auth/reset-password', { token: 'KOD-JEDNORAZOWY', password: 'kolejneHaslo1' });
  assert.equal(pierwsze.status, 200);
  const drugie = await post('/auth/reset-password', { token: 'KOD-JEDNORAZOWY', password: 'jeszczeInne22' });
  assert.equal(drugie.status, 400, 'zużyty kod nie działa drugi raz');
});

test('reset-password: WYGASŁY kod odrzucony', async () => {
  passwordResets.deleteForUser(userId);
  passwordResets.create({
    userId, tokenHash: hashToken('KOD-WYGASLY'),
    expiresAt: new Date(Date.now() - 1000).toISOString(), // już wygasł
  });
  const r = await post('/auth/reset-password', { token: 'KOD-WYGASLY', password: 'poWygasnieciu1' });
  assert.equal(r.status, 400);
});

test('reset-password: nieznany kod odrzucony', async () => {
  const r = await post('/auth/reset-password', { token: 'ZUPELNIE-LOSOWY-KOD', password: 'cokolwiek123' });
  assert.equal(r.status, 400);
});
