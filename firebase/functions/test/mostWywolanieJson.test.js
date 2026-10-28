import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * `wywolajModulPrzetargowy` (2026-10-28, auto-analiza SWZ): treść JSON idzie na Railway z nagłówkiem
 * content-type, a kod HTTP wraca w `status` — most NIE rzuca, więc wołający musi go sprawdzić.
 */
const { wywolajModulPrzetargowy } = await import('../src/services/mostRailway.js');
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('POST z JSON: ciało i content-type przekazane, ścieżka pod /api/przetarg; 429 zwrócone jako status', async () => {
  const zadania = [];
  globalThis.fetch = async (url, opcje) => {
    zadania.push({ url, metoda: opcje.method, typ: opcje.headers['content-type'], cialo: opcje.body ? JSON.parse(Buffer.from(opcje.body).toString('utf8')) : null, auth: opcje.headers.Authorization });
    return new Response(JSON.stringify({ error: { code: 'LIMIT_AI_DZIENNY' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  };
  const w = await wywolajModulPrzetargowy({ id: 'u1', most_railway_user_id: 'r1' }, { sciezka: '/swz/postepowania/7/analiza', dane: { swz_pdf_base64: 'JVBE' } });
  assert.equal(w.status, 429);
  assert.equal(w.dane.error.code, 'LIMIT_AI_DZIENNY');
  assert.equal(zadania.length, 1);
  assert.match(zadania[0].url, /\/api\/przetarg\/swz\/postepowania\/7\/analiza$/);
  assert.equal(zadania[0].metoda, 'POST');
  assert.equal(zadania[0].typ, 'application/json');
  assert.deepEqual(zadania[0].cialo, { swz_pdf_base64: 'JVBE' });
  assert.match(zadania[0].auth, /^Bearer /);
});
