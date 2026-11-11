import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

/*
 * MOST: dzienny limit pytań do SWZ w planie darmowym (audyt 2026-11-10).
 *
 * Radar SWZ w apce pyta `POST /api/przetarg/swz/postepowania/:id/zapytaj` wprost przez most,
 * a limit 3/dzień stał tylko przy `POST /wygrywalnosc/tender/:id/zapytaj-swz`. Teraz oba
 * liczą jeden licznik; po limicie most odmawia 429 BEZ ruchu do Railway. Standard — bez limitu.
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.MOST_ENABLED = 'true';
process.env.MOST_RAILWAY_URL = 'http://127.0.0.1:39123';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { LIMIT_PYTAN_SWZ_DARMOWY } = await import('../src/routes/wygrywalnosc.js');
const { getFirestore } = await import('firebase-admin/firestore');

const app = createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const PORT = serwer.address().port;
test.after(() => serwer.close());
const runtime = express();
runtime.use(express.json({ verify: (req, _res, bytes) => { req.rawBody = bytes; } }));
runtime.use(createApp());
const runtimeServer = runtime.listen(0);
test.after(() => runtimeServer.close());

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

let seq = 0;
async function konto({ standard = false, mapped = true } = {}) {
  seq++;
  const u = await users.create({ email: `mlim-${process.pid}-${seq}@t.pl`, passwordHash: 'x' });
  if (mapped) await users.ustawMostRailway(u.id, `rail-mlim-${process.pid}-${seq}`);
  if (standard) await users.setTier(u.id, 'standard');
  else await getFirestore().collection('users').doc(u.id).update({ proba_do: null });
  return signToken(u.id, 0);
}

function podstawRailway() {
  const zadania = [];
  globalThis.fetch = async (url) => {
    zadania.push(String(url));
    return new Response('{"odpowiedz":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return zadania;
}

function zapytaj(token, sciezka = '/api/przetarg/swz/postepowania/77/zapytaj', cialo = JSON.stringify({ pytanie: 'Jakie wadium?' }), port = PORT) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: sciezka, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cialo) },
    }, (res) => {
      let tresc = '';
      res.on('data', (c) => { tresc += c; });
      res.on('end', () => resolve({ status: res.statusCode, tresc }));
    });
    req.on('error', reject);
    req.end(cialo);
  });
}

test('Free: invalid questions never consume quota or reach Railway', async () => {
 for (const port of [PORT, runtimeServer.address().port]) {
  const token = await konto();
  const requests = podstawRailway();
  for (const body of ['{', '{}', '{"pytanie":" "}', '{"pytanie":42}', JSON.stringify({pytanie:'x'.repeat(501)})]) {
    assert.equal((await zapytaj(token, undefined, body, port)).status, 400, body);
  }
  assert.equal(requests.length, 0);
  for (let i=0;i<LIMIT_PYTAN_SWZ_DARMOWY;i++) assert.equal((await zapytaj(token, undefined, undefined, port)).status, 200);
  assert.equal((await zapytaj(token, undefined, undefined, port)).status, 429);
 }
});

test('Free: failure before identity mapping preserves all question attempts', async () => {
  const token = await konto({ mapped: false });
  let unavailable = true, questionCalls = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/register')) {
      if (unavailable) throw Error('identity connection unavailable');
      return new Response(JSON.stringify({user:{id:'recovered-'+seq}}), {status:201});
    }
    questionCalls++;
    return new Response('{"odpowiedz":"ok"}', {status:200});
  };
  for (let i=0;i<3;i++) assert.equal((await zapytaj(token)).status,502);
  assert.equal(questionCalls,0,'no AI question was forwarded');
  unavailable=false;
  for (let i=0;i<LIMIT_PYTAN_SWZ_DARMOWY;i++) assert.equal((await zapytaj(token)).status,200);
  assert.equal((await zapytaj(token)).status,429);
  assert.equal(questionCalls,LIMIT_PYTAN_SWZ_DARMOWY);
});

test('Free: ambiguous failure after forwarding still consumes an attempt', async () => {
  const token=await konto(); let questionCalls=0;
  globalThis.fetch=async()=>{questionCalls++;throw Error('response lost after request');};
  for(let i=0;i<LIMIT_PYTAN_SWZ_DARMOWY;i++)assert.equal((await zapytaj(token)).status,502);
  assert.equal((await zapytaj(token)).status,429);
  assert.equal(questionCalls,LIMIT_PYTAN_SWZ_DARMOWY);
});

test('Free: concurrent requests cannot exceed the shared question limit', async () => {
  const token=await konto();const requests=podstawRailway();
  const results=await Promise.all(Array.from({length:6},()=>zapytaj(token)));
  assert.equal(results.filter(r=>r.status===200).length,LIMIT_PYTAN_SWZ_DARMOWY);
  assert.equal(results.filter(r=>r.status===429).length,6-LIMIT_PYTAN_SWZ_DARMOWY);
  assert.equal(requests.length,LIMIT_PYTAN_SWZ_DARMOWY);
});

test('Free: po 3 pytaniach przez most — 429 i brak ruchu do Railway', async () => {
  const token = await konto();
  const zadania = podstawRailway();
  for (let i = 0; i < LIMIT_PYTAN_SWZ_DARMOWY; i++) {
    assert.equal((await zapytaj(token)).status, 200, `pytanie ${i + 1} przechodzi`);
  }
  const ponad = await zapytaj(token);
  assert.equal(ponad.status, 429);
  assert.match(JSON.parse(ponad.tresc).error.message, /3 pytania do SWZ dziennie/);
  assert.equal(zadania.filter((a) => a.includes('/zapytaj')).length, LIMIT_PYTAN_SWZ_DARMOWY, 'czwarte nie dotarło do Railway');
});

test('Standard: bez limitu; inne trasy Radaru SWZ (lista) nie zużywają licznika', async () => {
  const token = await konto({ standard: true });
  const zadania = podstawRailway();
  for (let i = 0; i < LIMIT_PYTAN_SWZ_DARMOWY + 2; i++) assert.equal((await zapytaj(token)).status, 200);
  assert.equal(zadania.length, LIMIT_PYTAN_SWZ_DARMOWY + 2);

  const free = await konto();
  podstawRailway();
  for (let i = 0; i < 5; i++) assert.equal((await zapytaj(free, '/api/przetarg/swz/postepowania')).status, 200, 'POST listy/nowego postępowania bez limitu pytań');
  assert.equal((await zapytaj(free)).status, 200, 'pytanie nadal dostępne');
});

test('Free: wielkość liter w trasie nie omija limitu przed Railway', async () => {
  const token = await konto();
  const zadania = podstawRailway();
  for (let i = 0; i < LIMIT_PYTAN_SWZ_DARMOWY; i++) assert.equal((await zapytaj(token)).status, 200);
  const ponad = await zapytaj(token, '/api/przetarg/SWZ/POSTEPOWANIA/77/ZAPYTAJ');
  assert.equal(ponad.status, 429);
  assert.equal(zadania.length, LIMIT_PYTAN_SWZ_DARMOWY, 'wariant wielkich liter nie dotarł do Railway');
});
