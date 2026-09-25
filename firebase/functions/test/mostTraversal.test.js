import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/*
 * MOST: path traversal (P2, 2026-09-25).
 *
 * Most przekazywał surowe `req.url`, a `fetch()` normalizuje ścieżkę (także
 * `%2e%2e` jako `..`) — `/api/przetarg/%2e%2e/%2e%2e/api/fitter/me` docierał do
 * Railway jako `/api/fitter/me`, z tokenem konta pomostowego. Most miał być rurą
 * WYŁĄCZNIE do `/api/przetarg/*`.
 *
 * Żądania wysyłamy przez `http.request`, bo `fetch` sam znormalizowałby ścieżkę
 * po stronie klienta i test sprawdzałby atrapę zamiast mostu.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { env } = await import('../src/config.js');
const { sciezkaMostu } = await import('../src/services/mostRailway.js');

const app = createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const PORT = serwer.address().port;
test.after(() => serwer.close());

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

let seq = 0;
async function token() {
  seq++;
  const u = await users.create({ email: `trav-${process.pid}-${seq}@t.pl`, passwordHash: 'x' });
  await users.ustawMostRailway(u.id, `rail-trav-${seq}`);
  return signToken(u.id, 0);
}

function podstawRailway() {
  const zadania = [];
  globalThis.fetch = async (url, opcje = {}) => {
    zadania.push({ adres: String(url), naglowki: opcje.headers ?? {} });
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return zadania;
}

function surowe(sciezka, naglowki = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: sciezka, method: 'GET', headers: naglowki }, (res) => {
      let tresc = '';
      res.on('data', (c) => { tresc += c; });
      res.on('end', () => resolve({ status: res.statusCode, tresc }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('%2e%2e w ścieżce → 400, Railway NIE jest wołany', async () => {
  const t = await token();
  const zadania = podstawRailway();

  const { status } = await surowe('/api/przetarg/%2e%2e/%2e%2e/api/fitter/me', { Authorization: `Bearer ${t}` });

  assert.equal(status, 400);
  assert.equal(zadania.length, 0, 'żadne żądanie nie może wyjść poza /api/przetarg/*');
});

test('zakodowany ukośnik (%2f, %5c) → 400', async () => {
  const t = await token();
  const zadania = podstawRailway();

  for (const sciezka of ['/api/przetarg/sejf%2f..%2f..%2fauth/me', '/api/przetarg/sejf%5C..%5Cauth']) {
    const { status } = await surowe(sciezka, { Authorization: `Bearer ${t}` });
    assert.equal(status, 400, sciezka);
  }
  assert.equal(zadania.length, 0);
});

test('surowe ../ wychodzące poza prefiks → 400', async () => {
  const t = await token();
  const zadania = podstawRailway();

  const { status } = await surowe('/api/przetarg/../../auth/me', { Authorization: `Bearer ${t}` });

  // Express może takiej ścieżki w ogóle nie skierować do mostu (404) — oba wyniki
  // są bezpieczne; niedopuszczalne jest tylko wyjście żądania do Railway.
  assert.ok([400, 404].includes(status), `status ${status}`);
  assert.equal(zadania.length, 0);
});

test('poprawna ścieżka z query przechodzi bez zmian; x-forwarded-* i host NIE idą dalej', async () => {
  const t = await token();
  const zadania = podstawRailway();

  const { status } = await surowe('/api/przetarg/podprogowe/ogloszenia?q=a%2Fb&limit=20', {
    Authorization: `Bearer ${t}`,
    'X-Forwarded-For': '6.6.6.6',
    'X-Forwarded-Host': 'evil.example',
    'X-Most-Podpis': 'podrobiony',
  });

  assert.equal(status, 200);
  assert.equal(zadania.length, 1);
  assert.equal(zadania[0].adres, `${env.MOST_RAILWAY_URL}/api/przetarg/podprogowe/ogloszenia?q=a%2Fb&limit=20`,
    'zakodowany ukośnik w QUERY jest legalny (wartość parametru), nie ścieżką');
  const klucze = Object.keys(zadania[0].naglowki).map((k) => k.toLowerCase());
  assert.ok(!klucze.some((k) => k.startsWith('x-forwarded-')), `przekazano: ${klucze.join(', ')}`);
  assert.ok(!klucze.includes('host'));
  assert.ok(!klucze.includes('x-most-podpis'), 'klient nie może podsunąć podpisu mostu');
});

test('sciezkaMostu: jednostkowo', () => {
  assert.equal(sciezkaMostu('/sejf/dokumenty?x=1'), '/api/przetarg/sejf/dokumenty?x=1');
  assert.equal(sciezkaMostu('/%2e%2e/%2e%2e/api/fitter/me'), null);
  assert.equal(sciezkaMostu('/%2E%2E/auth/me'), null);
  assert.equal(sciezkaMostu('/../../auth/me'), null);
  assert.equal(sciezkaMostu('/sejf/./dokumenty'), null);
  assert.equal(sciezkaMostu('/sejf\\..\\auth'), null);
  assert.equal(sciezkaMostu('//evil.example/x'), '/api/przetarg//evil.example/x',
    'podwójny ukośnik zostaje ŚCIEŻKĄ pod prefiksem, nie zmienia hosta');
});
