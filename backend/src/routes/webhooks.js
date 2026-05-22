import express, { Router } from 'express';
import { constructWebhookEvent } from '../services/stripe.js';
import { users } from '../db/repos.js';
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
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
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

export default router;
