import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

/*
 * Konta pomostowe (most Firebase → Railway) przez publiczne /auth/register — 2026-09-25.
 *
 * 1. Mail powitalny szedł na KAŻDY adres, także `most.<uid>@most.przetarg-ai.pl`. Ta domena
 *    nie istnieje => twarde odbicia w Resend psują reputację nadawcy (i dostarczalność
 *    maili do prawdziwych klientów).
 * 2. Każdy mógł zająć cudzy adres pomostowy (zarejestrować go z własnym hasłem), zanim
 *    zrobi to most — wtedy most dostaje 409, logowanie jego hasłem pada i moduły
 *    /api/przetarg są dla tego użytkownika martwe. Teraz rejestracja w domenie mostu
 *    wymaga nagłówka `X-Most-Podpis` = HMAC-SHA256(JWT_SECRET, email) w hex.
 * 3. `company_name` trafiał do HTML maila bez escape'owania => dowolny HTML (link,
 *    formularz) w mailu z naszą marką, wysłany na adres podany przez atakującego.
 *
 * Wysyłkę obserwujemy na atrapie API Resend (RESEND_BASE_URL) — czarna skrzynka, bez
 * podmieniania modułów aplikacji.
 */

const odebrane = [];
const atrapaResend = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    odebrane.push({ url: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `fake-${odebrane.length}` }));
  });
});
await new Promise((r) => atrapaResend.listen(0, '127.0.0.1', r));

const SEKRET = process.env.JWT_SECRET;
const DB_FILE = path.join(os.tmpdir(), `przetargai-most-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = 're_test_atrapa';
process.env.RESEND_BASE_URL = `http://127.0.0.1:${atrapaResend.address().port}`;
delete process.env.MOST_EMAIL_DOMENA;
delete process.env.MOST_WYMAGAJ_PODPISU;

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { welcomeEmail, subscriptionActiveEmail, resetPasswordEmail, sendEmail } = await import('../src/services/email.js');

let server;
let base;

before(() => {
  migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  atrapaResend.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${DB_FILE}${s}`, { force: true }); } catch { /* Windows: plik bywa zablokowany */ }
  }
});

const podpis = (email) => crypto.createHmac('sha256', SEKRET).update(email).digest('hex');

async function rejestruj(body, naglowki = {}) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...naglowki },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Mail jest wysyłany fire-and-forget — czekamy chwilę na dotarcie do atrapy. */
async function mailDo(adres, { czekajMs = 1500 } = {}) {
  const koniec = Date.now() + czekajMs;
  while (Date.now() < koniec) {
    const m = odebrane.find((x) => [].concat(x.body.to).includes(adres));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

// ══════════════════════════ Konta pomostowe ═══════════════════════════════════

test('rejestracja adresu mostu z poprawnym podpisem → 201 i ŻADNEGO maila (domena nie istnieje)', async () => {
  const email = `most.abc${process.pid}@most.przetarg-ai.pl`;
  const r = await rejestruj({ email, password: 'haslo-mostu-123' }, { 'X-Most-Podpis': podpis(email) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(await mailDo(email), null, 'brak maila powitalnego na adres techniczny');
});

test('podpis liczony z adresu po normalizacji (małe litery) — UID Firebase ma wielkie litery', async () => {
  const surowy = `most.XyZ${process.pid}@most.przetarg-ai.pl`;
  const r = await rejestruj({ email: surowy, password: 'haslo-mostu-123' }, { 'X-Most-Podpis': podpis(surowy.toLowerCase()) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
});

test('rejestracja adresu mostu BEZ podpisu → 403 (nie da się zająć cudzego adresu pomostowego)', async () => {
  const email = `most.bez${process.pid}@most.przetarg-ai.pl`;
  const r = await rejestruj({ email, password: 'haslo-atakujacego' });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(email).n, 0, 'konto nie powstało');
});

test('rejestracja adresu mostu ze ZŁYM podpisem → 403', async () => {
  const email = `most.zly${process.pid}@most.przetarg-ai.pl`;
  const r1 = await rejestruj({ email, password: 'haslo-atakujacego' }, { 'X-Most-Podpis': podpis(`inny-${email}`) });
  assert.equal(r1.status, 403);
  const r2 = await rejestruj({ email, password: 'haslo-atakujacego' }, { 'X-Most-Podpis': 'zz' });
  assert.equal(r2.status, 403, 'podpis o złej długości/formacie też odrzucony (bez wyjątku)');
});

test('podpis nie wycieka informacji o istnieniu konta: bez podpisu 403 także dla zajętego adresu', async () => {
  const email = `most.zajety${process.pid}@most.przetarg-ai.pl`;
  assert.equal((await rejestruj({ email, password: 'haslo-mostu-123' }, { 'X-Most-Podpis': podpis(email) })).status, 201);
  assert.equal((await rejestruj({ email, password: 'cokolwiek12' })).status, 403, 'nie 409');
});

// ══════════════════════════ Zwykła rejestracja + escape ═══════════════════════

test('zwykły adres → mail powitalny wysłany, company_name z <script> zescape’owany', async () => {
  const email = `klient-${process.pid}@firma.pl`;
  const r = await rejestruj({
    email, password: 'haslo12345', company_name: '<script>alert(1)</script><a href="https://zlo.example">Zaloguj</a>',
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const mail = await mailDo(email);
  assert.ok(mail, 'mail powitalny dotarł do Resend');
  assert.ok(!mail.body.html.includes('<script>'), 'brak surowego <script> w HTML');
  assert.ok(!mail.body.html.includes('<a href'), 'brak wstrzykniętego linku w HTML');
  assert.ok(mail.body.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'treść zescape’owana, nie wycięta');
});

test('sendEmail nigdy nie wysyła na domenę mostu (obrona w głąb: reset hasła, webhooki)', async () => {
  const wynik = await sendEmail({ to: 'most.x@most.przetarg-ai.pl', subject: 's', html: '<p>x</p>', text: 'x' });
  assert.equal(wynik.sent, false);
  assert.equal(await mailDo('most.x@most.przetarg-ai.pl', { czekajMs: 200 }), null);
});

test('szablony: każde pole wstawiane do HTML jest escape’owane', () => {
  const zlo = `"><img src=x onerror=alert(1)>&'`;
  for (const { html } of [welcomeEmail(zlo), subscriptionActiveEmail(zlo), resetPasswordEmail(zlo)]) {
    assert.ok(!html.includes('<img'), html);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&amp;&#39;') || html.includes('&lt;img src=x onerror=alert(1)&gt;&amp;&#x27;'), html);
    assert.ok(html.includes('&quot;&gt;'), html);
  }
});
