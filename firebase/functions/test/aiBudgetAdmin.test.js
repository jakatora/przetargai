import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.ANTHROPIC_API_KEY = '';
process.env.ADMIN_API_KEY = 'budget-admin-test-only';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { getFirestore } = await import('firebase-admin/firestore');
const { createApp } = await import('../src/app.js');
const { reserveAiBudget } = await import('../src/services/aiBudget.js');
const { klasyfikujBladAi } = await import('../src/lib/stanAi.js');
const db = getFirestore();
const server = createApp().listen(0);
after(() => { server.closeAllConnections(); server.close(); });
const base = () => `http://127.0.0.1:${server.address().port}/admin/ai-budget`;
async function call(path, { key = 'budget-admin-test-only', body } = {}) {
  const res = await fetch(base() + path, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

test('admin HTTP: inspect pending, reject unauthorized/unsafe release, reconcile once with evidence', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const balance = db.collection('ai_usage_monthly').doc(month);
  await balance.set({ cost_usd: 0, calls: 0 });
  const held = await reserveAiBudget({ model: 'claude-haiku-4-5', maxTokens: 300,
    operation: 'admin-proof', hardLimitUsd: 10 });
  const ref = db.collection('ai_budget_reservations').doc(held.id);
  const amount = (await ref.get()).data().amount;
  const path = `/reservations/${held.id}/reconcile`;
  const body = { outcome: 'not_billed', reference: 'Provider support case TEST-123: no charge confirmed', expectedAmount: amount };
  for (const key of ['', 'wrong']) {
    assert.equal((await call('/reservations', { key })).status, 403);
    assert.equal((await call(path, { key, body })).status, 403);
  }
  const status = await call('');
  assert.equal(status.body.spentUsd, 0);
  assert.equal(status.body.reservedUsd, amount / 1e6);
  assert.equal((await call('/reservations?limit=0')).status, 400);
  assert.equal((await call('/reservations?limit=1000')).status, 400);
  assert.equal((await call(path, { body: { ...body, reference: '' } })).status, 400);
  assert.equal((await call(path, { body })).status, 409, 'active call cannot be manually released');
  await ref.update({ created_at: new Date(Date.now() - 600000).toISOString() });
  assert.equal((await call(path, { body: { ...body, expectedAmount: amount + 1 } })).status, 409);
  const listed = await call('/reservations?limit=100');
  assert.ok(listed.body.items.some(item => item.id === held.id));
  const first = await call(path, { body });
  assert.equal(first.status, 200);
  assert.equal(first.body.changed, true);
  assert.equal(first.body.budget.reservedUsd, 0);
  assert.equal((await call(path, { body })).body.changed, false);
  assert.equal((await ref.get()).data().reconciliation.reference, body.reference);
  assert.equal((await balance.get()).data().cost_usd, 0);
});

test('budget exhausted is classified as budget, not an unknown provider failure', () => {
  assert.equal(klasyfikujBladAi({ code: 'AI_BUDGET_EXHAUSTED', message: 'Monthly AI budget exhausted' }).typ, 'budzet');
});

test('admin HTTP: confirmed usage booked once; pending list uses a bounded cursor', async () => {
  const args = { model: 'claude-haiku-4-5', maxTokens: 300, operation: 'admin-billed-proof', hardLimitUsd: 10 };
  const held = await reserveAiBudget(args);
  await reserveAiBudget(args);
  const ref = db.collection('ai_budget_reservations').doc(held.id);
  const amount = (await ref.get()).data().amount;
  await ref.update({ created_at: new Date(Date.now() - 600000).toISOString() });
  const first = await call('/reservations?limit=1');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.ok(first.body.nextCursor);
  const second = await call(`/reservations?limit=1&cursor=${first.body.nextCursor}`);
  assert.equal(second.status, 200);
  assert.notEqual(first.body.items[0].id, second.body.items[0].id);
  assert.equal('userId' in first.body.items[0], false);
  const body = { expectedAmount: amount, outcome: 'billed', usage: { input_tokens: 1000, output_tokens: 100 },
    reference: 'Provider usage export TEST-456 verified by operator' };
  const path = `/reservations/${held.id}/reconcile`;
  const result = await call(path, { body });
  assert.equal(result.status, 200);
  assert.equal(result.body.changed, true);
  assert.equal(result.body.budget.spentUsd, 0.0015);
  const duplicate = await call(path, { body });
  assert.equal(duplicate.body.changed, false);
  assert.equal(duplicate.body.budget.spentUsd, 0.0015);
  assert.equal((await db.collection('ai_usage').doc(held.id).get()).data().cost_usd, 0.0015);
  assert.equal((await ref.get()).data().reconciliation.outcome, 'billed');
});
