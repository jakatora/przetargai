import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polaczZEmulatorem } from './emulator.js';
await polaczZEmulatorem();
const { getFirestore } = await import('firebase-admin/firestore');
const { reserveAiBudget, settleAiBudget, maximumCallCost, budgetedMessage } = await import('../src/services/aiBudget.js');
const db = getFirestore();
const model = 'claude-haiku-4-5';
let seq = 0;
async function fixture(limit = 1) {
  const now = new Date(Date.UTC(2100, seq++, 1));
  const month = now.toISOString().slice(0, 7);
  const ref = db.collection('ai_usage_monthly').doc(month);
  await ref.set({ cost_usd: 0, calls: 0 });
  return { ref, args: { model, maxTokens: 300, operation: 'budget-test', hardLimitUsd: limit, now } };
}

test('concurrent reservations share one durable balance', async () => {
  const amount = maximumCallCost(model, 300);
  const { ref, args } = await fixture(amount * 2 / 1e6);
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveAiBudget(args)));
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal((await ref.get()).data().reserved_microusd, amount * 2);
});

test('independent service instances still enforce the same database limit', async () => {
  const amount = maximumCallCost(model, 300);
  const { ref, args } = await fixture(amount * 2 / 1e6);
  const other = await import('../src/services/aiBudget.js?independent-worker');
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    (i % 2 ? other.reserveAiBudget : reserveAiBudget)(args)));
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal((await ref.get()).data().reserved_microusd, amount * 2);
});

test('corrupt reservation cannot change balance; failed transaction does not poison the queue', async () => {
  const { ref, args } = await fixture();
  for (const change of [{ month: 'invalid' }, { operation: '' }, { amount: -1 }, { state: 'unknown' }]) {
    const held = await reserveAiBudget(args);
    const record = db.collection('ai_budget_reservations').doc(held.id);
    const original = (await record.get()).data();
    const balance = (await ref.get()).data();
    await record.update(change);
    await assert.rejects(settleAiBudget(held), /invalid reservation/);
    assert.deepEqual((await ref.get()).data(), balance);
    await record.set(original);
    assert.equal(await settleAiBudget(held), true);
  }
});

test('settlement is idempotent under concurrent delivery and releases only the unused reserve', async () => {
  const { ref, args } = await fixture();
  const held = await reserveAiBudget(args);
  const results = await Promise.all(Array.from({ length: 5 }, () => settleAiBudget(held, { input_tokens: 1000, output_tokens: 100 })));
  assert.equal(results.filter(Boolean).length, 1);
  const data = (await ref.get()).data();
  assert.equal(data.calls, 1);
  assert.equal(data.cost_usd, 0.0015);
  assert.equal(data.reserved_microusd, 0);
  assert.equal((await db.collection('ai_usage').doc(held.id).get()).data().cost_usd, 0.0015);
});

test('settlement uses reservation month, not current calendar month', async () => {
  const { ref, args } = await fixture();
  const held = await reserveAiBudget(args);
  assert.notEqual(held.month, new Date().toISOString().slice(0, 7));
  await settleAiBudget(held, { input_tokens: 1000, output_tokens: 100 });
  assert.equal((await ref.get()).data().cost_usd, 0.0015);
});

test('unknown outcome survives new service import and blocks new spend', async () => {
  const { ref, args } = await fixture(maximumCallCost(model, 300) / 1e6);
  await reserveAiBudget(args);
  const fresh = await import('../src/services/aiBudget.js?another-instance');
  assert.equal(await fresh.reserveAiBudget(args), null);
  assert.ok((await ref.get()).data().reserved_microusd > 0);
});

test('definitive rejection releases reservation once without recording paid usage', async () => {
  const { ref, args } = await fixture();
  const held = await reserveAiBudget(args);
  assert.equal(await settleAiBudget(held), true);
  assert.equal(await settleAiBudget(held), false);
  assert.equal((await ref.get()).data().cost_usd, 0);
  assert.equal((await ref.get()).data().reserved_microusd, 0);
  assert.equal((await db.collection('ai_usage').doc(held.id).get()).exists, false);
});

test('missing or impossible usage retains conservative reservation', async () => {
  const { ref, args } = await fixture();
  const held = await reserveAiBudget(args);
  await assert.rejects(settleAiBudget(held, {}), /invalid provider usage/);
  await assert.rejects(settleAiBudget(held, { input_tokens: 2000000, output_tokens: 1 }), /exceeds reservation/);
  assert.ok((await ref.get()).data().reserved_microusd > 0);
});

test('unknown models and invalid budget balances fail closed', async () => {
  assert.throws(() => maximumCallCost('toString', 300));
  assert.throws(() => maximumCallCost(model, NaN));
  const { ref, args } = await fixture();
  await ref.set({ cost_usd: -1 });
  await assert.rejects(reserveAiBudget(args), /invalid stored balance/);
});

test('provider wrapper disables retries and persists uncertain response cost', async () => {
  const ref = db.collection('ai_usage_monthly').doc(new Date().toISOString().slice(0, 7));
  await ref.set({ cost_usd: 0, calls: 0 });
  let calls = 0;
  const client = { messages: { create: async (_request, opts) => {
    calls++;
    assert.equal(opts.maxRetries, 0);
    throw Object.assign(new Error('uncertain'), { status: 503 });
  } } };
  const request = { model, max_tokens: 300 };
  await assert.rejects(budgetedMessage(client, request, { operation: 'test', hardLimitUsd: 1 }), /uncertain/);
  assert.equal(calls, 1);
  assert.equal((await ref.get()).data().reserved_microusd, maximumCallCost(model, 300));
  client.messages.create = async () => ({ content: [] });
  await assert.rejects(budgetedMessage(client, request, { operation: 'test', hardLimitUsd: 1 }), /missing provider usage/);
  assert.equal((await ref.get()).data().reserved_microusd, 2 * maximumCallCost(model, 300));
  client.messages.create = async () => { throw Object.assign(new Error('invalid request'), { status: 400 }); };
  await assert.rejects(budgetedMessage(client, request, { operation: 'test', hardLimitUsd: 1 }), /invalid request/);
  assert.equal((await ref.get()).data().reserved_microusd, 2 * maximumCallCost(model, 300));
});
