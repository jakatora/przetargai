import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { env } from '../config/env.js';
import { createFitterCheckoutSession, isStripeEnabled } from '../services/stripe.js';
import { badRequest, serviceUnavailable } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

// Stripe checkout dla Fitter Welder Pro. MVP: brak auth, deviceId jako
// client_reference_id. Webhook (services/stripe → routes/webhooks.js)
// wykryje metadata.project=fitter i zapisze do osobnej tabeli (Phase 6b).

const router = Router();

const checkoutSchema = z.object({
  plan: z.enum(['monthly', 'yearly']),
  device_id: z.string().min(8).max(128),
  customer_email: z.string().email().optional(),
});

/** POST /api/fitter/billing/checkout — apka mobilna woła, dostaje URL. */
router.post('/checkout', ah(async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Wymagane: plan (monthly|yearly), device_id');
  if (!isStripeEnabled()) throw serviceUnavailable('Płatności chwilowo niedostępne');

  const { plan, device_id: deviceId, customer_email: customerEmail } = parsed.data;

  const session = await createFitterCheckoutSession({
    plan,
    deviceId,
    customerEmail,
    successUrl: `${env.APP_URL}/api/fitter/billing/success`,
    cancelUrl: `${env.APP_URL}/api/fitter/billing/cancel`,
  });

  audit({ userId: `fitter:${deviceId}`, action: 'fitter_checkout_started', ip: req.ip });
  logger.info({ deviceId, plan, sessionId: session.id }, 'Fitter checkout session created');

  res.json({ checkout_url: session.url });
}));

/** Minimal HTML success/cancel pages (reuse the PrzetargAI style). */
function pageShell({ title, glyph, body, accent }) {
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Fitter Welder Pro</title>
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}body{padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1117;color:#e8ecf0;min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#1a1d26;border-radius:16px;padding:36px 28px;max-width:420px;width:100%;text-align:center;border:1px solid #2c3354}.glyph{width:64px;height:64px;border-radius:50%;background:${accent};color:#000;font-size:30px;font-weight:700;line-height:64px;margin:0 auto 18px}h1{margin:0 0 14px;font-size:22px}p{margin:0 0 14px;line-height:1.55;color:#9ba3c7;font-size:15px}.brand{margin-top:26px;font-size:13px;color:#55607a;letter-spacing:0.04em}</style></head>
<body><main class="card"><div class="glyph">${glyph}</div><h1>${title}</h1>${body}<p class="brand">Fitter Welder Pro</p></main></body></html>`;
}

router.get('/success', (_req, res) => {
  res.type('html').send(pageShell({
    title: 'Subskrypcja Premium aktywna',
    glyph: '✓',
    body: '<p>Twoja subskrypcja <strong>Fitter Welder Pro+</strong> jest aktywna. Wróć do aplikacji — wszystkie funkcje PRO są odblokowane.</p>',
    accent: '#E8C14B',
  }));
});

router.get('/cancel', (_req, res) => {
  res.type('html').send(pageShell({
    title: 'Płatność anulowana',
    glyph: '×',
    body: '<p>Nie została pobrana żadna opłata. Możesz spróbować ponownie z poziomu aplikacji.</p>',
    accent: '#E57373',
  }));
});

export default router;
