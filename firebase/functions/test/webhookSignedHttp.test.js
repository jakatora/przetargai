import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import Stripe from 'stripe';

// Tylko lokalny podpis, żadne klucze Stripe ani płatne usługi.
process.env.STRIPE_SECRET_KEY = 'sk_test_local_signature_only';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_signature_only';
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.FAKTUROWANIE_ENABLED = 'false';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');

test('podpisany webhook HTTP: podpis, projekt, zapłata, aktywacja i ponowienie', async (t) => {
  // Adapter odtwarza rawBody dostarczane przez Google Functions. Cała aplikacja
  // Express, router, weryfikator podpisu i repozytoria są produkcyjne.
  const host = express();
  host.use(express.json({ verify(req, _res, bytes) { req.rawBody = bytes; } }));
  host.use(createApp());
  const server = host.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/webhooks/stripe`;
  const user = await users.create({
    email: `signed-http-${process.pid}@example.invalid`, passwordHash: 'unused', keywords: [],
  });
  let seq = 0;
  const event = (overrides = {}) => ({
    id: `evt_http_${process.pid}_${++seq}`, type: 'checkout.session.completed',
    data: { object: {
      id: `cs_http_${process.pid}_${seq}`, client_reference_id: user.id,
      mode: 'subscription', metadata: { project: 'przetargai' },
      payment_status: 'no_payment_required', amount_total: 0,
      customer: 'cus_local_http', subscription: 'sub_local_http', ...overrides,
    } },
  });
  async function send(value, { secret = process.env.STRIPE_WEBHOOK_SECRET, tamper = false } = {}) {
    const payload = JSON.stringify(value);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
      body: tamper ? `${payload} ` : payload,
    });
    return { status: response.status, body: await response.json() };
  }
  const tier = async () => (await users.findById(user.id)).premium_tier;
  const valid = event();
  assert.equal((await send(valid, { secret: 'wrong_signature_secret' })).status, 400);
  assert.equal((await send(valid, { tamper: true })).status, 400);
  assert.equal(await tier(), 'free');
  for (const rejected of [
    { metadata: { project: 'czaspracy' } }, { metadata: {} },
    { mode: 'payment' }, { payment_status: 'unpaid' },
  ]) {
    assert.equal((await send(event(rejected))).status, 200);
    assert.equal(await tier(), 'free');
  }
  // Błędny podpis nie może zająć event.id i zablokować prawidłowego ponowienia.
  assert.deepEqual(await send(valid), { status: 200, body: { received: true } });
  assert.equal(await tier(), 'standard');
  assert.deepEqual(await send(valid), {
    status: 200, body: { received: true, duplicate: true },
  });
  const saved = await users.findById(user.id);
  assert.equal(saved.stripe_customer_id, 'cus_local_http');
  assert.equal(saved.stripe_subscription_id, 'sub_local_http');
});
