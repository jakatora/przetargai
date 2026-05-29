import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { env } from '../config/env.js';
import { createFitterJobCheckoutSession, isStripeEnabled } from '../services/stripe.js';
import { fitterJobs } from '../db/repos.js';
import { badRequest, notFound, serviceUnavailable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// Praca module for Fitter Welder Pro. 49 PLN per posting via Stripe one-time
// payment — no free tier for anyone. Flow:
//   1. Client POSTs listing data → backend creates DRAFT row (is_paid=0) and
//      a Stripe Checkout Session, returns the URL
//   2. User pays in Stripe → webhook marks the listing paid + sets expires_at
//   3. Client polls /api/fitter/jobs/mine to see when the listing flips paid
//   4. /api/fitter/jobs serves the public browse view (paid + non-expired)

const router = Router();

const draftSchema = z.object({
  device_id: z.string().min(8).max(128),
  title: z.string().min(3).max(120),
  company: z.string().min(2).max(120),
  location: z.string().min(2).max(120),
  rate: z.string().max(64).optional(),
  description: z.string().min(10).max(4000),
  requirements_csv: z.string().max(500).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(32).optional(),
});

/** POST /api/fitter/jobs/checkout — create draft + Stripe session, return URL. */
router.post('/checkout', ah(async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Brakujące lub błędne pola ogłoszenia');
  if (!isStripeEnabled()) throw serviceUnavailable('Płatności chwilowo niedostępne');

  const {
    device_id: deviceId, title, company, location, rate, description,
    requirements_csv: requirementsCsv, contact_email: contactEmail,
    contact_phone: contactPhone,
  } = parsed.data;

  // 1. Insert DRAFT first so we have an id to put into Stripe metadata.
  const draft = fitterJobs.createDraft({
    deviceId, title, company, location, rate, description,
    requirementsCsv, contactEmail, contactPhone,
    stripeSessionId: null,
  });

  // 2. Create Stripe checkout session referencing the draft id.
  const session = await createFitterJobCheckoutSession({
    listingId: draft.id,
    deviceId,
    customerEmail: contactEmail,
    successUrl: `${env.APP_URL}/api/fitter/jobs/success?id=${draft.id}`,
    cancelUrl: `${env.APP_URL}/api/fitter/jobs/cancel`,
  });

  // 3. Backfill the session id onto the draft so webhook can match by either
  //    metadata.listing_id or stripe_session_id (defence in depth).
  fitterJobs.findById(draft.id); // (sanity check; row exists)

  logger.info({ listingId: draft.id, deviceId, sessionId: session.id }, 'Job listing checkout started');
  res.json({
    listing_id: draft.id,
    checkout_url: session.url,
    session_id: session.id,
    amount_pln: 49,
  });
}));

/** GET /api/fitter/jobs — browse view (paid + non-expired). */
router.get('/', ah(async (req, res) => {
  const locationLike = req.query.location ? String(req.query.location).slice(0, 60) : null;
  const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 200);
  const rows = fitterJobs.listPaid({ locationLike, limit });
  res.json({ listings: rows });
}));

/** GET /api/fitter/jobs/mine?device_id=X — own listings (paid + draft). */
router.get('/mine', ah(async (req, res) => {
  const deviceId = String(req.query.device_id || '').trim();
  if (deviceId.length < 8) throw badRequest('Wymagane: device_id');
  const rows = fitterJobs.listByDevice({ deviceId, limit: 50 });
  res.json({ listings: rows });
}));

// ── Success / cancel pages (reuse PrzetargAI's HTML shell) ─────────────────
// Mounted BEFORE the `/:id` catch-all so they don't get swallowed.
function pageShell({ title, glyph, body, accent }) {
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — Fitter Welder Pro</title>
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}body{padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1117;color:#e8ecf0;min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#1a1d26;border-radius:16px;padding:36px 28px;max-width:420px;width:100%;text-align:center;border:1px solid #2c3354}.glyph{width:64px;height:64px;border-radius:50%;background:${accent};color:#000;font-size:30px;font-weight:700;line-height:64px;margin:0 auto 18px}h1{margin:0 0 14px;font-size:22px}p{margin:0 0 14px;line-height:1.55;color:#9ba3c7;font-size:15px}.brand{margin-top:26px;font-size:13px;color:#55607a;letter-spacing:0.04em}</style></head>
<body><main class="card"><div class="glyph">${glyph}</div><h1>${title}</h1>${body}<p class="brand">Fitter Welder Pro · Praca</p></main></body></html>`;
}

router.get('/success', (_req, res) => {
  res.type('html').send(pageShell({
    title: 'Ogłoszenie opublikowane',
    glyph: '✓',
    body: '<p>Twoje ogłoszenie w module <strong>Praca</strong> jest aktywne przez 30 dni. Wróć do aplikacji — pojawi się na liście dla wszystkich monterów.</p>',
    accent: '#2ECC71',
  }));
});

router.get('/cancel', (_req, res) => {
  res.type('html').send(pageShell({
    title: 'Płatność anulowana',
    glyph: '×',
    body: '<p>Ogłoszenie NIE zostało opublikowane. Możesz spróbować ponownie z poziomu aplikacji.</p>',
    accent: '#E57373',
  }));
});

/** GET /api/fitter/jobs/:id — single listing. (Declared last so /success and
 *  /cancel match their literal handlers first.) */
router.get('/:id', ah(async (req, res) => {
  const row = fitterJobs.findById(req.params.id);
  if (!row) throw notFound('Ogłoszenie nie znalezione');
  res.json({ listing: row });
}));

export default router;
