import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Ręczny wyzwalacz okna BK — musi być BEZPŁATNY.
 *
 * `/admin/fetch-tenders` uruchamia pełny cykl RAZEM z dopasowaniami, czyli płatne
 * wywołania Claude. Operator sprawdzający, czy import ze źródła żyje, nie powinien
 * za to płacić — i nie powinien mieć pokusy, żeby użyć tamtego endpointu „bo jest".
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.ADMIN_API_KEY = 'testowy-klucz-administratora';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');

async function zapytaj(sciezka, naglowki = {}) {
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const res = await fetch(`http://127.0.0.1:${port}${sciezka}`, { method: 'POST', headers: naglowki });
    return { status: res.status, cialo: await res.json().catch(() => null) };
  } finally {
    serwer.close();
  }
}

test('/admin/okno-bk wymaga klucza administratora', async () => {
  const { status } = await zapytaj('/admin/okno-bk');
  assert.equal(status, 403);
});

test('/admin/okno-bk NIE woła cyklu dopasowań (żadnego płatnego AI)', async () => {
  const zrodlo = await import('../src/routes/admin.js');
  assert.ok(zrodlo, 'router musi się załadować');

  const { readFileSync } = await import('node:fs');
  const kod = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const blok = kod.slice(kod.indexOf("router.post('/okno-bk'"), kod.indexOf("/** Podstawowe statystyki"));
  assert.ok(blok.includes('runBkOkno'), 'endpoint ma wołać wyłącznie przebieg okna');
  assert.ok(!blok.includes('runTenderFetch'), 'cykl dopasowań = płatne wywołania Claude');
  assert.ok(!blok.includes('backfillUser'), 'backfill też płaci za AI');
});
