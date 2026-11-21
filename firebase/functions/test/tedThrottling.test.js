import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pobierzOgloszeniaTed } from '../src/services/ted.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function page(numbers, total) {
  return Response.json({
    totalNoticeCount: total,
    notices: numbers.map((number) => ({
      'publication-number': number,
      'title-proc': { pol: `Ogłoszenie ${number}` },
    })),
  });
}

function fakeTime() {
  let now = Date.parse('2026-11-20T10:00:00Z');
  const waits = [];
  return {
    waits,
    tempo: { teraz: () => now, spij: async (ms) => { waits.push(ms); now += ms; }, odstepMs: 0 },
  };
}

test('TED: 429 na drugiej stronie jest ponawiane bez utraty pierwszej i bez duplikatów', async () => {
  const queries = [];
  const time = fakeTime();
  const counter = { surowe: 0, odrzucone: 0, zapytania: 0 };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body);
    if (queries.length === 1) return page(['1-2026', '2-2026'], 3);
    if (queries.length === 2) return new Response('temporary limit', { status: 429, headers: { 'Retry-After': '25' } });
    return page(['3-2026'], 3);
  };
  const notices = await pobierzOgloszeniaTed({ rozmiarStrony: 2, licznik: counter, tempo: time.tempo });
  assert.deepEqual(notices.map((x) => x.externalId), ['ted:1-2026', 'ted:2-2026', 'ted:3-2026']);
  assert.deepEqual(queries.map((x) => x.page), [1, 2, 2]);
  assert.deepEqual(queries[1], queries[2], 'ponowienie dotyczy dokładnie tej samej strony');
  assert.ok(time.waits.includes(25_000), 'Retry-After nie może być skrócone');
  assert.deepEqual(counter, { surowe: 3, odrzucone: 0, zapytania: 3 });
});

test('TED: trwały limit kończy się jawnym błędem po trzech próbach, nie pustą listą', async () => {
  let requests = 0;
  const time = fakeTime();
  globalThis.fetch = async () => { requests++; return new Response('limit TED', { status: 429 }); };
  await assert.rejects(() => pobierzOgloszeniaTed({ tempo: time.tempo }), /TED.*429/);
  assert.equal(requests, 3);
  assert.deepEqual(time.waits, [20_000, 40_000]);
});

test('TED: przejściowe zerwanie połączenia nie kasuje importu', async () => {
  let requests = 0;
  const time = fakeTime();
  globalThis.fetch = async () => {
    if (++requests === 1) throw new TypeError('fetch failed');
    return page(['1-2026'], 1);
  };
  assert.equal((await pobierzOgloszeniaTed({ tempo: time.tempo })).length, 1);
  assert.equal(requests, 2);
});

test('TED: błędne zapytanie 400 nie jest ponawiane', async () => {
  let requests = 0;
  const time = fakeTime();
  globalThis.fetch = async () => { requests++; return new Response('invalid field', { status: 400 }); };
  await assert.rejects(() => pobierzOgloszeniaTed({ tempo: time.tempo }), /400.*invalid field/);
  assert.equal(requests, 1);
  assert.deepEqual(time.waits, []);
});

test('TED: długie Retry-After nie jest skracane ani nie blokuje pozostałych źródeł', async () => {
  let requests = 0;
  const time = fakeTime();
  globalThis.fetch = async () => { requests++; return new Response('limit TED', { status: 429, headers: { 'Retry-After': '3600' } }); };
  await assert.rejects(() => pobierzOgloszeniaTed({ budzetMs: 30_000, tempo: time.tempo }), /429/);
  assert.equal(requests, 1);
  assert.deepEqual(time.waits, []);
});

test('TED: Retry-After jako data HTTP jest respektowane', async () => {
  const time = fakeTime();
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1
    ? new Response('limit', { status: 429, headers: { 'Retry-After': 'Fri, 20 Nov 2026 10:00:45 GMT' } })
    : page(['1-2026'], 1);
  assert.equal((await pobierzOgloszeniaTed({ tempo: time.tempo })).length, 1);
  assert.deepEqual(time.waits, [45_000]);
});

test('TED: nieczytelne Retry-After używa ograniczonego backoffu', async () => {
  const time = fakeTime();
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1
    ? new Response('limit', { status: 429, headers: { 'Retry-After': 'unknown' } })
    : page(['1-2026'], 1);
  assert.equal((await pobierzOgloszeniaTed({ tempo: time.tempo })).length, 1);
  assert.deepEqual(time.waits, [20_000]);
});

test('TED: pusty budżet po poprzednim źródle nie uruchamia nawet pierwszego zapytania', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return page([], 0); };
  await assert.rejects(() => pobierzOgloszeniaTed({ budzetMs: 0, tempo: fakeTime().tempo }), /budżet czasu/);
  assert.equal(requests, 0);
});

test('TED: wspólny budżet obowiązuje także między stronami, zamiast zwracać niepełny sukces', async () => {
  const time = fakeTime();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return page(['1-2026'], 2); };
  await assert.rejects(() => pobierzOgloszeniaTed({
    budzetMs: 200, tempo: { ...time.tempo, odstepMs: 300 },
  }), /budżet czasu/);
  assert.equal(requests, 1);
});

test('TED: błędny JSON odpowiedzi nie jest pozorowany jako pusta lista ani ponawiany', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('<html>not JSON</html>'); };
  await assert.rejects(() => pobierzOgloszeniaTed({ tempo: fakeTime().tempo }), SyntaxError);
  assert.equal(requests, 1);
});

test('TED: odzyskiwanie po 429 działa również z rzeczywistym HTTP i treścią POST', async (t) => {
  const { createServer } = await import('node:http');
  const bodies = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push({ method: req.method, body: JSON.parse(body) });
    if (bodies.length === 1) {
      res.writeHead(429, { 'Retry-After': '1' }).end('limited');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        totalNoticeCount: 1,
        notices: [{ 'publication-number': '1-2026', 'title-proc': { pol: 'Przetarg HTTP' } }],
      }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const notices = await pobierzOgloszeniaTed({ tempo: {
    ...fakeTime().tempo,
    fetchFn: (_url, options) => originalFetch(`http://127.0.0.1:${server.address().port}/search`, options),
  } });
  assert.equal(notices.length, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].method, 'POST');
  assert.deepEqual(bodies[0], bodies[1], 'treść strony nie zmienia się przy ponowieniu HTTP');
});
