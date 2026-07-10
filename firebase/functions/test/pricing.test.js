import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costUsd, isModelPriced, MODEL_PRICING } from '../src/lib/pricing.js';

/*
 * Decyzja: PrzetargAI używa JEDNEGO modelu — Claude Haiku 4.5.
 * Zadania AI (ocena dopasowania, streszczenie ogłoszenia) to klasyfikacja,
 * ekstrakcja i streszczanie. Nie wymagają Opusa ani Fable.
 *
 * Cennik zweryfikowany 2026-07-09 na platform.claude.com/docs/en/about-claude/pricing:
 *   Haiku 4.5 — $1 / MTok wejścia, $5 / MTok wyjścia
 *   Batch API — 50% zniżki na wejściu i wyjściu ($0,50 / $2,50)
 *
 * Poprzednia wersja miała dwa błędy:
 *  1. Opus 4.7 wyceniony na $15/$75 (to cena Opus 4.1). Realnie $5/$25.
 *  2. `DEFAULT_PRICING = Haiku` — nieznany model wyceniany jak Haiku, po cichu.
 *     Przy Opus 4.8 ($5/$25) dałoby to PIĘCIOKROTNE zaniżenie kosztu, a twardy
 *     limit $500 odpaliłby dopiero przy ~$2500 realnego wydatku.
 */

test('costUsd — Haiku 4.5: 1M wejścia + 1M wyjścia = 6 USD', () => {
  assert.equal(costUsd('claude-haiku-4-5', 1_000_000, 1_000_000), 6);
});

test('costUsd — akceptuje pełny identyfikator z datą, nie tylko alias', () => {
  assert.equal(costUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000), 6);
});

test('costUsd — zero tokenów = zero kosztu', () => {
  assert.equal(costUsd('claude-haiku-4-5', 0, 0), 0);
});

test('costUsd — koszt rośnie monotonicznie z liczbą tokenów', () => {
  const a = costUsd('claude-haiku-4-5', 1000, 1000);
  const b = costUsd('claude-haiku-4-5', 2000, 2000);
  assert.ok(b > a);
});

test('KRYTYCZNE: nieznany model rzuca błąd, zamiast cicho wyceniać jak Haiku', () => {
  // Cicha wycena nieznanego modelu zaniżałaby koszt i rozbrajała limit budżetu.
  assert.throws(
    () => costUsd('claude-opus-4-8', 1_000_000, 0),
    /nieznany model|unknown model/i,
  );
  assert.throws(() => costUsd('model-nieznany', 1_000_000, 0));
});

test('costUsd — Batch API daje dokładnie 50% zniżki na wejściu i wyjściu', () => {
  const zwykly = costUsd('claude-haiku-4-5', 1_000_000, 1_000_000);
  const batch = costUsd('claude-haiku-4-5', 1_000_000, 1_000_000, { batch: true });
  assert.equal(batch, zwykly / 2);
  assert.equal(batch, 3); // $0,50 + $2,50
});

test('isModelPriced — rozpoznaje nasz model i odrzuca resztę', () => {
  assert.equal(isModelPriced('claude-haiku-4-5'), true);
  assert.equal(isModelPriced('claude-haiku-4-5-20251001'), true);
  assert.equal(isModelPriced('claude-opus-4-8'), false);
  assert.equal(isModelPriced(''), false);
  assert.equal(isModelPriced(undefined), false);
});

test('MODEL_PRICING — zawiera wyłącznie modele, które ten backend realnie wywołuje', () => {
  // Każdy dodatkowy wiersz to cena, która może się zdezaktualizować niezauważona.
  // Haiku 4.5  — PrzetargAI (matching) + services/fitterAi.js
  // Sonnet 4.6 — services/fitterScan.js (wizja: rysunki izometryczne)
  const modele = Object.keys(MODEL_PRICING);
  assert.deepEqual(modele.sort(), [
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
  ]);
  assert.deepEqual(MODEL_PRICING['claude-haiku-4-5'], { input: 1.0, output: 5.0 });
});

test('costUsd — Sonnet 4.6 (skaner ISO Fittera): 1M wejścia + 1M wyjścia = 18 USD', () => {
  // fitterScan.js woła Sonneta świadomie — Haiku gubi szczegóły na gęstym rysunku.
  assert.equal(costUsd('claude-sonnet-4-6', 1_000_000, 1_000_000), 18);
});

test('REGRESJA: costUsd wywołane z obiektem rzuca, zamiast po cichu księgować 0 USD', () => {
  // fitterScan.js:136 wołał costUsd({ model, inputTokens, outputTokens }) — argumenty
  // są POZYCYJNE. Obiekt trafiał jako `model`, tokeny przyjmowały domyślne zera,
  // a DEFAULT_PRICING połykał nieznany klucz. Każdy skan ISO kosztował „0 USD".
  assert.throws(
    () => costUsd({ model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    /model musi być tekstem|nieznany model/i,
  );
});
