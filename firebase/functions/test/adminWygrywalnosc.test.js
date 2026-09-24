import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Wyzwalacze operatora dla etapu 6 — muszą być BEZPŁATNE i muszą mieścić się
 * w funkcji, w której biegną.
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.ADMIN_API_KEY = 'testowy-klucz-administratora';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');

const KOD_ADMINA = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');

async function zapytaj(sciezka, naglowki = {}) {
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const res = await fetch(`http://127.0.0.1:${port}${sciezka}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...naglowki },
      body: '{}',
    });
    return { status: res.status };
  } finally {
    serwer.close();
  }
}

/** Blok kodu jednego endpointu — od jego `router.post` do następnego komentarza sekcji. */
function blokEndpointu(sciezka) {
  const od = KOD_ADMINA.indexOf(`router.post('${sciezka}'`);
  assert.ok(od > 0, `nie znaleziono endpointu ${sciezka}`);
  const reszta = KOD_ADMINA.slice(od + 10);
  const do_ = reszta.indexOf('router.');
  return do_ > 0 ? reszta.slice(0, do_) : reszta;
}

describe('/admin/okno-wynikow — domykanie okna rozstrzygnięć', () => {
  test('wymaga klucza administratora', async () => {
    assert.equal((await zapytaj('/admin/okno-wynikow')).status, 403);
  });

  test('NIE woła cyklu dopasowań ani backfillu (żadnego płatnego AI)', () => {
    const blok = blokEndpointu('/okno-wynikow');
    assert.ok(blok.includes('runOknoWynikow'), 'endpoint ma wołać wyłącznie przebieg okna');
    assert.ok(!blok.includes('runTenderFetch'), 'cykl dopasowań = płatne wywołania Claude');
    assert.ok(!blok.includes('backfillUser'), 'backfill też płaci za AI');
  });

  test('ma WŁASNY, krótszy budżet niż przebieg z harmonogramu', async () => {
    /*
     * Ten przebieg biegnie w funkcji `api` (300 s), a nie w `wynikiOknoFetch`
     * (1800 s). Bez własnego budżetu platforma ubiłaby żądanie w połowie i
     * checkpoint — zapisywany na końcu przebiegu — nie zanotowałby ŻADNEJ
     * domkniętej doby, więc operator wołałby w kółko te same dni.
     */
    const blok = blokEndpointu('/okno-wynikow');
    assert.ok(/budzetMs/.test(blok), 'wyzwalacz nie ustawia własnego budżetu czasu');

    const { BUDZET_OKNA_MS } = await import('../src/jobs/oknoWynikow.js');
    const dopasowanie = /const BUDZET_WYZWALACZA_MS = ([\d_]+);/.exec(KOD_ADMINA);
    assert.ok(dopasowanie, 'brak stałej budżetu wyzwalacza');
    const budzetWyzwalacza = Number(dopasowanie[1].replaceAll('_', ''));
    assert.ok(budzetWyzwalacza < BUDZET_OKNA_MS,
      `budżet wyzwalacza (${budzetWyzwalacza}) musi być krótszy niż harmonogramowy (${BUDZET_OKNA_MS})`);
    assert.ok(budzetWyzwalacza < 300_000, 'budżet musi zmieścić się w limicie funkcji api (300 s)');
  });
});

describe('/admin/benchmark — przeliczenie z bazy', () => {
  test('wymaga klucza administratora', async () => {
    assert.equal((await zapytaj('/admin/benchmark')).status, 403);
  });

  test('liczy z ZAPISANYCH rozstrzygnięć, nie sięga po rejestry', () => {
    const blok = blokEndpointu('/benchmark');
    assert.ok(blok.includes('runBenchmarkRynku'));
    assert.ok(!blok.includes('runOknoWynikow'), 'przeliczenie nie ma pobierać danych ze źródeł');
    assert.ok(!blok.includes('runTenderFetch'));
  });
});
