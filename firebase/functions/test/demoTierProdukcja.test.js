import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * NAJWAŻNIEJSZY test przełącznika demo: na PRODUKCJI trasa /demo/tier
 * nie może istnieć. Bez tego strażnika każde darmowe konto nadawałoby
 * sobie plan Standard jednym żądaniem — zero przychodu.
 *
 * Osobny proces z NODE_ENV=production (config czyta env przy imporcie).
 */

process.env.NODE_ENV = 'production';
process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { env } = await import('../src/config.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

test('warunek wstępny: proces faktycznie udaje produkcję', () => {
  assert.equal(env.NODE_ENV, 'production');
});

test('KRYTYCZNE: /demo/tier NA PRODUKCJI nie istnieje (404), nawet z tokenem-śmieciem', async () => {
  const odp = await fetch(`${BAZA}/demo/tier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer cokolwiek' },
    body: JSON.stringify({ tier: 'standard' }),
  });
  assert.equal(odp.status, 404,
    'trasa demo zamontowana na produkcji = darmowy Standard dla każdego');
});
