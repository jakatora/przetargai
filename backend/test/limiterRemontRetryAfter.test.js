import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const file = path.join(os.tmpdir(), `remont-retry-after-${process.pid}.db`);
process.env.DATABASE_PATH = file;
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

test('Remont exposes Retry-After on a real 429 while retaining the shared 120/min limit', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 120; i++) {
      const response = await fetch(`${base}/api/remont/not-a-route`, { headers: { Origin: 'https://asystent-remontu.example' } });
      await response.arrayBuffer();
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('access-control-expose-headers'), 'Retry-After');
      assert.equal(Number(response.headers.get('ratelimit-remaining')), 119 - i);
    }
    const limited = await fetch(`${base}/api/remont/not-a-route`);
    await limited.arrayBuffer();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('access-control-expose-headers'), 'Retry-After');
    const wait = Number(limited.headers.get('retry-after'));
    assert.ok(wait > 0 && wait <= 60);
    const other = await fetch(`${base}/api/fitter/billing/not-a-route`);
    await other.arrayBuffer();
    assert.equal(other.status, 429, 'The existing shared bucket remains shared');
    assert.equal(other.headers.get('access-control-expose-headers'), null, 'Remont CORS does not alter other modules');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  }
});
