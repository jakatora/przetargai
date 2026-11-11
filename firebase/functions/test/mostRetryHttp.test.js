import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';

// Real HTTP transport with a controlled Railway boundary: no paid AI or customer data.
let handler;
const server = http.createServer((req, res) => handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.MOST_RAILWAY_URL = `http://127.0.0.1:${server.address().port}`;
const { wywolajModulPrzetargowy } = await import('../src/services/mostRailway.js');
const { env } = await import('../src/config.js');
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

const user = { id: 'retry-http-test', most_railway_user_id: 'existing-test-account' };
const request = { sciezka: '/swz/postepowania/7/zapytaj', dane: { pytanie: 'Jaki jest termin?' } };

for (const status of [400, 401, 429, 500, 503]) {
  test(`HTTP ${status}: paid POST is forwarded once without automatic retry`, async () => {
    const received = [];
    handler = async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push({ url: req.url, method: req.method,
        body: JSON.parse(Buffer.concat(chunks).toString()),
        user: jwt.verify(req.headers.authorization.slice(7), env.JWT_SECRET).sub });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'CONTROLLED_FAILURE' } }));
    };
    const result = await wywolajModulPrzetargowy(user, request);
    assert.equal(result.status, status);
    assert.equal(result.dane.error.code, 'CONTROLLED_FAILURE');
    assert.deepEqual(received, [{ url: '/api/przetarg/swz/postepowania/7/zapytaj',
      method: 'POST', body: request.dane, user: user.most_railway_user_id }]);
  });
}

test('connection lost after receiving POST: unknown outcome is not automatically retried', async () => {
  let calls = 0;
  handler = async (req) => {
    for await (const chunk of req) { /* consume request before losing response */ }
    calls++;
    req.socket.destroy();
  };
  await assert.rejects(wywolajModulPrzetargowy(user, request));
  assert.equal(calls, 1);
});

test('timeout after receiving POST: unknown outcome is not automatically retried', async () => {
  let calls = 0;
  handler = async (req) => {
    for await (const chunk of req) { /* consume, intentionally send no response */ }
    calls++;
  };
  await assert.rejects(wywolajModulPrzetargowy(user, { ...request, limitMs: 200 }),
    error => error.name === 'TimeoutError');
  assert.equal(calls, 1);
});
