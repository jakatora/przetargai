import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * AUDYT 2026-07-09, znalezisko CRITICAL (plans/AUDYT-2026-07-09.md):
 * `scoreTenderMatch` sprawdzał twardy limit budżetu przed wywołaniem Claude'a,
 * ale `scanFitterIso` (Sonnet 4.6, wizja) i `chatFitter` (Haiku) NIE sprawdzały
 * go wcale — a trasy /api/fitter/scan-iso i /api/fitter/ai są nieuwierzytelnione.
 * Budżet jest WSPÓLNY (ai_usage nie ma kolumny projektu), więc wydatki Fittera
 * po przekroczeniu $500 gaszą matching AI płacącym userom PrzetargAI.
 *
 * Wymaganie: JEDNA bramka, wspólna dla każdego płatnego wywołania AI.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-gate-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-do-testow';
process.env.AI_BUDGET_SOFT_USD = '200';
process.env.AI_BUDGET_HARD_USD = '500';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { aiUsage } = await import('../src/db/repos.js');
const { budgetStatus, aiBudgetAllows } = await import('../src/services/ai.js');
const { scanFitterIso } = await import('../src/services/fitterScan.js');
const { chatFitter } = await import('../src/services/fitterAi.js');

before(() => migrate());
after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${suffix}`, { force: true });
});

function wydaj(usd) {
  aiUsage.record({ operation: 'test', model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costUsd: usd });
}

test('aiBudgetAllows — poniżej limitu przepuszcza', () => {
  assert.equal(aiBudgetAllows('test'), true);
  assert.equal(budgetStatus().hardExceeded, false);
});

test('aiBudgetAllows — po przekroczeniu twardego limitu blokuje KAŻDE wywołanie AI', () => {
  wydaj(500);
  assert.equal(budgetStatus().hardExceeded, true);
  assert.equal(aiBudgetAllows('match'), false);
  assert.equal(aiBudgetAllows('fitter_scan'), false, 'Fitter też musi respektować wspólny budżet');
  assert.equal(aiBudgetAllows('fitter_chat'), false);
});

test('KRYTYCZNE: scanFitterIso odmawia po przekroczeniu budżetu, zamiast wołać Sonneta', async () => {
  // Budżet już przekroczony poprzednim testem. Klient Anthropic ISTNIEJE (klucz-atrapa),
  // więc gdyby bramki nie było, doszłoby do prawdziwego (płatnego) wywołania sieciowego.
  await assert.rejects(
    () => scanFitterIso({ imageBase64: 'AAAA', mediaType: 'image/jpeg', deviceId: 'urzadzenie-testowe' }),
    (err) => err.status === 503 && /budżet|limit/i.test(err.message),
    'skan ISO musi odbić się o bramkę budżetu, nie o timeout sieci',
  );
});

test('KRYTYCZNE: chatFitter odmawia po przekroczeniu budżetu', async () => {
  await assert.rejects(
    () => chatFitter({ message: 'Jak spawać rurę DN100?', history: [], lang: 'pl' }),
    (err) => err.status === 503 && /budżet|limit/i.test(err.message),
  );
});
