import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

/*
 * Most gubił CIAŁO żądań w runtime Cloud Functions (web-flow 2026-09-29).
 *
 * Runtime Functions (produkcja i emulator) parsuje żądanie ZANIM dotrze do naszej
 * aplikacji: `req.body` jest już obiektem, oryginalne bajty leżą w `req.rawBody`,
 * a `express.raw()` na trasie mostu nie ma już czego czytać. Most przekazywał
 * `req.body` — obiekt bez `.length` — więc POST/PATCH szły do Railway BEZ ciała:
 * „Dodaj do sejfu" i „utwórz analizę SWZ" kończyły się 400. Testy mostu na czystym
 * Expressie tego nie widziały, bo tam express.raw() czyta strumień sam.
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.MOST_ENABLED = 'true';
process.env.MOST_RAILWAY_URL = 'http://127.0.0.1:39126';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { env } = await import('../src/config.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

/** Aplikacja opakowana tak, jak robi to runtime Functions (parser JSON + rawBody). */
function jakWRuntimeFunctions() {
  const runtime = express();
  runtime.use(express.json({ limit: '32mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  runtime.use(createApp());
  return runtime;
}

test('POST przez most w runtime Functions dociera do Railway z oryginalnym ciałem', async () => {
  const user = await users.create({ email: `most-cialo-${process.pid}@test.invalid`, passwordHash: 'x' });
  const token = signToken(user.id, 0);

  const doRailway = [];
  globalThis.fetch = async (url, opcje = {}) => {
    const adres = String(url);
    if (!adres.startsWith(env.MOST_RAILWAY_URL)) return oryginalnyFetch(url, opcje);
    const sciezka = new URL(adres).pathname;
    if (sciezka === '/auth/register') return Response.json({ user: { id: 'rw-cialo' } }, { status: 201 });
    doRailway.push({ sciezka, metoda: opcje.method, cialo: opcje.body ? Buffer.from(opcje.body).toString('utf8') : null });
    return Response.json({ ok: true }, { status: 201 });
  };

  const serwer = jakWRuntimeFunctions().listen(0);
  try {
    const odp = await fetch(`http://127.0.0.1:${serwer.address().port}/api/przetarg/sejf/dokumenty`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typ: 'krk', data_wystawienia: '2026-09-20' }),
    });
    assert.equal(odp.status, 201);
  } finally {
    serwer.close();
  }

  const zadanie = doRailway.find((z) => z.sciezka === '/api/przetarg/sejf/dokumenty');
  assert.ok(zadanie, 'żądanie dotarło do Railway');
  assert.equal(zadanie.metoda, 'POST');
  assert.deepEqual(JSON.parse(zadanie.cialo ?? 'null'), { typ: 'krk', data_wystawienia: '2026-09-20' });
});
