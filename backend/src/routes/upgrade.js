import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { env } from '../config/env.js';
import { users } from '../db/repos.js';
import { consumeUpgradeLink } from '../services/magicLink.js';
import { createCheckoutSession, isStripeEnabled } from '../services/stripe.js';
import { badRequest, notFound, serviceUnavailable } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

const router = Router();

const schema = z.object({
  user_id: z.string().min(1),
  token: z.string().min(1),
});

/**
 * Wywoływane przez landing (przetargai.pl/upgrade) po otwarciu magic linku
 * z aplikacji mobilnej. Weryfikuje link i zwraca URL Stripe Checkout.
 */
router.post('/', ah(async (req, res) => {
  const result = schema.safeParse(req.body);
  if (!result.success) throw badRequest('Wymagane pola: user_id, token');
  const { user_id: userId, token } = result.data;

  const user = users.findById(userId);
  if (!user) throw notFound('Użytkownik nie istnieje');
  if (user.premium_tier === 'standard') throw badRequest('Subskrypcja Standard jest już aktywna');

  if (!consumeUpgradeLink(userId, token)) {
    throw badRequest('Link do subskrypcji jest nieprawidłowy lub wygasł');
  }
  if (!isStripeEnabled()) {
    throw serviceUnavailable('Płatności chwilowo niedostępne — skontaktuj się z obsługą');
  }

  const session = await createCheckoutSession({
    user,
    successUrl: `${env.LANDING_URL}/upgrade/success`,
    cancelUrl: `${env.LANDING_URL}/upgrade/cancel`,
  });

  audit({ userId: user.id, action: 'checkout_started', ip: req.ip });
  logger.info({ userId: user.id, sessionId: session.id }, 'Utworzono sesję Stripe Checkout');
  res.json({ checkout_url: session.url });
}));

export default router;
