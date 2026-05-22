import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costUsd } from '../src/lib/pricing.js';

test('costUsd — Haiku 4.5: 1M wejścia + 1M wyjścia = 6 USD', () => {
  assert.equal(costUsd('claude-haiku-4-5', 1_000_000, 1_000_000), 6);
});

test('costUsd — nieznany model używa cennika domyślnego', () => {
  assert.equal(costUsd('model-nieznany', 1_000_000, 0), 1);
});

test('costUsd — zero tokenów = zero kosztu', () => {
  assert.equal(costUsd('claude-haiku-4-5', 0, 0), 0);
});

test('costUsd — koszt rośnie monotonicznie z liczbą tokenów', () => {
  const a = costUsd('claude-haiku-4-5', 1000, 1000);
  const b = costUsd('claude-haiku-4-5', 2000, 2000);
  assert.ok(b > a);
});
