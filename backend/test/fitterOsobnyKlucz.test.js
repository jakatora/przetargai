import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Klucz Anthropic PrzetargAI (ANTHROPIC_API_KEY) jest WYŁĄCZNIE dla PrzetargAI
 * (decyzja właściciela 2026-10-17). Trasy Fitter Welder Pro na tym samym serwerze
 * nie mogą po niego sięgać: mają własny FITTER_ANTHROPIC_API_KEY, a bez niego
 * odpowiadają 503 — nawet gdy klucz PrzetargAI jest ustawiony.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-fitter-klucz-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-klucza-przetargai';
process.env.FITTER_ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { features } = await import('../src/config/env.js');

let server;
let base;

before(() => {
  migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function post(route, body) {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

test('klucz PrzetargAI włącza AI PrzetargAI, ale nie AI Fittera', () => {
  assert.equal(features.ai, true);
  assert.equal(features.fitterAi, false);
});

test('czat Fittera bez własnego klucza = 503 mimo ustawionego klucza PrzetargAI', async () => {
  assert.equal(await post('/api/fitter/ai/chat', { message: 'Jaki gaz do TIG stali nierdzewnej?', device_id: 'urzadzenie-testowe-1' }), 503);
});

test('skan ISO Fittera bez własnego klucza = 503 mimo ustawionego klucza PrzetargAI', async () => {
  assert.equal(await post('/api/fitter/scan-iso', { image_base64: 'A'.repeat(128), device_id: 'urzadzenie-testowe-1' }), 503);
});
