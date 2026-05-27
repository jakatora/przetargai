import express, { Router } from 'express';
import { constructWebhookEvent, stripe } from '../services/stripe.js';
import { users, fitterPremium } from '../db/repos.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { sendEmail, subscriptionActiveEmail } from '../services/email.js';
import { createStandardInvoice } from '../services/invoice.js';

const router = Router();

/**
 * Webhook Stripe. Wymaga SUROWEGO body do weryfikacji podpisu — parser raw
 * jest zamontowany lokalnie, a router jest podpięty przed globalnym express.json().
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    logger.warn({ err: err.message }, 'Webhook Stripe — odrzucony (błąd weryfikacji podpisu)');
    return res.status(400).json({ error: 'Nieprawidłowy podpis webhooka' });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Logujemy, ale odpowiadamy 200 — błąd nie może wymuszać retry w nieskończoność.
    logger.error({ err: err.message, type: event.type }, 'Błąd obsługi webhooka Stripe');
  }
  res.json({ received: true });
});

async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // Branch on metadata.project — Fitter Welder Pro uses device_id, no
      // user account; PrzetargAI uses client_reference_id → users table.
      if (session.metadata?.project === 'fitter') {
        await handleFitterCheckoutCompleted(session);
        break;
      }
      const userId = session.client_reference_id || session.metadata?.user_id;
      const user = userId ? users.findById(userId) : null;
      if (!user) {
        logger.warn({ sessionId: session.id }, 'Webhook: nie znaleziono użytkownika dla sesji');
        return;
      }
      if (session.customer) users.setStripeCustomer(user.id, session.customer);
      if (session.subscription) users.setStripeSubscription(user.id, session.subscription);
      users.setTier(user.id, 'standard');
      audit({ userId: user.id, action: 'subscription_activated' });
      logger.info({ userId: user.id }, 'Subskrypcja Standard aktywowana');

      sendEmail({ to: user.email, ...subscriptionActiveEmail(user.company_name) })
        .catch((err) => logger.error({ err: err.message }, 'Email aktywacji nie wysłany'));
      createStandardInvoice({
        buyerName: user.company_name,
        buyerNip: user.company_nip,
        buyerEmail: user.email,
      }).catch((err) => logger.error({ err: err.message }, 'Faktura nie wystawiona'));
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      if (sub.metadata?.project === 'fitter') {
        const status = sub.cancel_at_period_end ? 'canceled' : (sub.status || 'active');
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        fitterPremium.updateStatusBySubscription(sub.id, status, periodEnd);
        logger.info({ subId: sub.id, status }, 'Fitter subscription updated');
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      if (sub.metadata?.project === 'fitter') {
        fitterPremium.updateStatusBySubscription(sub.id, 'canceled', null);
        logger.info({ subId: sub.id }, 'Fitter subscription cancelled');
        break;
      }
      const user = users.findByStripeCustomer(sub.customer);
      if (user) {
        users.setTier(user.id, 'free');
        users.setStripeSubscription(user.id, null);
        audit({ userId: user.id, action: 'subscription_cancelled' });
        logger.info({ userId: user.id }, 'Subskrypcja anulowana — powrót do planu Free');
      }
      break;
    }
    default:
      logger.debug({ type: event.type }, 'Webhook Stripe — zdarzenie pominięte');
  }
}

/**
 * Aktywacja Premium dla Fitter Welder Pro. Wywołane gdy Stripe potwierdzi
 * checkout.session.completed z metadata.project === 'fitter'. Pobiera
 * subscription period_end z API (session sam nie ma tej informacji)
 * i zapisuje wpis w fitter_premium keyed na device_id.
 */
async function handleFitterCheckoutCompleted(session) {
  const deviceId = session.client_reference_id || session.metadata?.device_id;
  const plan = session.metadata?.plan; // 'monthly' lub 'yearly'
  if (!deviceId || !plan) {
    logger.warn({ sessionId: session.id }, 'Fitter checkout: brak device_id lub plan w metadata');
    return;
  }
  let periodEnd = null;
  if (session.subscription && stripe) {
    try {
      const sub = await stripe.subscriptions.retrieve(session.subscription);
      if (sub.current_period_end) {
        periodEnd = new Date(sub.current_period_end * 1000).toISOString();
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Fitter checkout: nie udało się pobrać subscription');
    }
  }
  fitterPremium.upsert({
    deviceId,
    plan,
    status: 'active',
    customerId: session.customer || null,
    subscriptionId: session.subscription || null,
    currentPeriodEnd: periodEnd,
  });
  logger.info({ deviceId, plan, sub: session.subscription }, 'Fitter Premium activated');
}

export default router;
