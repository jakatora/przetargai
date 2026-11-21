import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { costUsd } from '../lib/pricing.js';
import { conflict } from '../lib/errors.js';

// Conservative upper bound, not an estimate of the usual prompt size.
// https://platform.claude.com/docs/en/models/haiku-4-5/overview
// https://platform.claude.com/docs/en/about-claude/pricing
const CONTEXT = { 'claude-haiku-4-5': 200000, 'claude-haiku-4-5-20251001': 200000,
  'claude-sonnet-4-6': 1000000 };
const micros = value => Math.ceil(value * 1e6);
const money = value => Number.isFinite(value) && value >= 0;
const validOperation = value => typeof value === 'string' && value.length > 0 && value.length <= 255;

// Avoid this instance competing with itself for the monthly document lock.
// Only the short DB transaction is queued; provider requests remain parallel.
// Firestore transactions still enforce the budget across independent instances.
let transactionTail = Promise.resolve();
function budgetTransaction(db, work) {
  const result = transactionTail.then(() => db.runTransaction(work));
  transactionTail = result.catch(() => {});
  return result;
}

export function maximumCallCost(model, maxTokens) {
  if (!Object.hasOwn(CONTEXT, model) || !Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new Error('AI budget: unsupported model or output limit');
  }
  return micros(costUsd(model, CONTEXT[model], maxTokens));
}

/** Durable reservation: an interrupted instance cannot silently release unknown spend. */
export async function reserveAiBudget({ model, maxTokens, operation, hardLimitUsd, now = new Date() }) {
  if (!money(hardLimitUsd)) throw new Error('AI budget: invalid limit');
  if (!validOperation(operation)) throw new Error('AI budget: invalid operation');
  const amount = maximumCallCost(model, maxTokens);
  const month = now.toISOString().slice(0, 7);
  const db = getFirestore();
  const balance = db.collection('ai_usage_monthly').doc(month);
  const ref = db.collection('ai_budget_reservations').doc(randomUUID());
  return budgetTransaction(db, async tx => {
    const snap = await tx.get(balance);
    const data = snap.data() ?? {};
    const spent = data.cost_usd ?? 0, pending = data.reserved_microusd ?? 0;
    if (!money(spent) || !Number.isSafeInteger(pending) || pending < 0) {
      throw new Error('AI budget: invalid stored balance');
    }
    if (micros(spent) + pending + amount > Math.floor(hardLimitUsd * 1e6)) return null;
    tx.set(balance, { reserved_microusd: pending + amount }, { merge: true });
    tx.create(ref, { month, amount, model, operation, state: 'pending', created_at: now.toISOString() });
    return { id: ref.id, month };
  });
}

/** Idempotent settlement; retained reservations need explicit reconciliation after unknown outcomes. */
export async function settleAiBudget(reservation, usage = null, userId = null, reconciliation = null) {
  const db = getFirestore();
  const ref = db.collection('ai_budget_reservations').doc(reservation.id);
  return budgetTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('AI budget: missing reservation');
    const held = snap.data();
    if (typeof held.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(held.month)
      || !validOperation(held.operation) || !Object.hasOwn(CONTEXT, held.model)
      || !Number.isSafeInteger(held.amount) || held.amount <= 0) {
      throw new Error('AI budget: invalid reservation');
    }
    if (held.state === 'settled' || held.state === 'rejected') return false;
    if (held.state !== 'pending') throw new Error('AI budget: invalid reservation state');
    if (reconciliation) {
      const age = Date.now() - Date.parse(held.created_at);
      if (!Number.isFinite(age) || age < 300000 || held.amount !== reconciliation.expectedAmount) {
        throw conflict('Rezerwacja jest zbyt nowa lub zmieniła się. Odśwież podgląd.');
      }
    }
    const balance = db.collection('ai_usage_monthly').doc(held.month);
    const data = (await tx.get(balance)).data() ?? {};
    const pending = data.reserved_microusd ?? 0;
    if (!Number.isSafeInteger(pending) || pending < held.amount || !money(data.cost_usd ?? 0)) {
      throw new Error('AI budget: inconsistent balance');
    }
    let cost = 0;
    if (usage) {
      if (![usage.input_tokens, usage.output_tokens].every(x => Number.isSafeInteger(x) && x >= 0)) {
        throw new Error('AI budget: missing or invalid provider usage');
      }
      cost = costUsd(held.model, usage.input_tokens, usage.output_tokens);
      if (micros(cost) > held.amount) throw new Error('AI budget: usage exceeds reservation');
      tx.create(db.collection('ai_usage').doc(reservation.id), {
        operation: held.operation, model: held.model, input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens, cost_usd: cost, user_id: userId,
        created_at: new Date().toISOString(), ttl: new Date(Date.now() + 90 * 86400000),
      });
    }
    tx.set(balance, { reserved_microusd: pending - held.amount,
      cost_usd: (data.cost_usd ?? 0) + cost, calls: (data.calls ?? 0) + (usage ? 1 : 0),
      input_tokens: (data.input_tokens ?? 0) + (usage?.input_tokens ?? 0),
      output_tokens: (data.output_tokens ?? 0) + (usage?.output_tokens ?? 0) }, { merge: true });
    tx.update(ref, { state: usage ? 'settled' : 'rejected', cost_usd: cost,
      settled_at: new Date().toISOString(), ttl: new Date(Date.now() + 90 * 86400000),
      ...(reconciliation ? { reconciliation: { reference: reconciliation.reference,
        outcome: usage ? 'billed' : 'not_billed', actor: 'admin' } } : {}) });
    return true;
  });
}

/** Operational readout: pending money is explicitly separate from billed usage. */
export async function readAiBudgetBalance() {
  const data = (await getFirestore().collection('ai_usage_monthly')
    .doc(new Date().toISOString().slice(0, 7)).get()).data() ?? {};
  return { spentUsd: data.cost_usd ?? 0, calls: data.calls ?? 0,
    reservedUsd: (data.reserved_microusd ?? 0) / 1e6 };
}

export async function pendingAiReservations({ limit = 50, cursor } = {}) {
  let query = getFirestore().collection('ai_budget_reservations').where('state', '==', 'pending')
    .orderBy(FieldPath.documentId());
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.limit(limit + 1).get();
  const page = snap.docs.slice(0, limit);
  return { items: page.map(doc => {
    const d = doc.data();
    return { id: doc.id, month: d.month, model: d.model, operation: d.operation,
      createdAt: d.created_at, reservedMicrousd: d.amount, reservedUsd: d.amount / 1e6 };
  }), nextCursor: snap.size > limit ? page.at(-1).id : null };
}

export async function budgetedMessage(client, request, { operation, userId = null, hardLimitUsd }) {
  const reservation = await reserveAiBudget({ model: request.model, maxTokens: request.max_tokens,
    operation, hardLimitUsd });
  if (!reservation) throw Object.assign(new Error('Monthly AI budget exhausted'), { code: 'AI_BUDGET_EXHAUSTED' });
  let response;
  try {
    // One reservation covers one attempt. SDK retries must not multiply unknown charges.
    response = await client.messages.create(request, { maxRetries: 0 });
  } catch (error) {
    if ([400, 401, 403, 404, 413, 422, 429].includes(error.status)) {
      await settleAiBudget(reservation);
    }
    // Timeout, dropped response, 5xx: keep the maximum reserved, never assume free.
    throw error;
  }
  // Missing usage is not the explicit `null` used for a confirmed rejection.
  // Keep the reservation if the provider returned an incomplete response.
  if (!response?.usage) throw new Error('AI budget: missing provider usage');
  await settleAiBudget(reservation, response.usage, userId);
  return response;
}
