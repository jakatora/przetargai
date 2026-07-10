import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { env } from '../config.js';
import { users, magicLinks } from '../db/repos.js';
import { consumeUpgradeLink } from '../services/magicLink.js';
import { createCheckoutSession, isStripeEnabled } from '../services/stripe.js';
import { badRequest, notFound, serviceUnavailable } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

const router = Router();

const upgradeSchema = z.object({
  user_id: z.string().min(1),
  token: z.string().min(1),
});

/**
 * Wspólna logika: weryfikuje magic link, tworzy sesję Stripe Checkout.
 * Używana przez POST (apka mobilna woła bezpośrednio) i GET (redirect z magic linka w mailu).
 * Success/cancel URL-e wskazują na backend — landing nie istnieje (D-016).
 *
 * KOLEJNOŚĆ (naprawa audytu 2026-07-09): dawniej link był ZUŻYWANY (markUsed)
 * PRZED utworzeniem sesji Stripe, więc przejściowy błąd Stripe bezpowrotnie palił
 * jednorazowy token. Teraz: (1) peek — walidacja bez zużycia, (2) sesja Stripe,
 * (3) consume — transakcyjne zużycie DOPIERO po sukcesie. Gdy Stripe padnie, link
 * zostaje ważny i użytkownik może spróbować ponownie.
 */
async function startCheckout({ userId, token, req }) {
  const user = await users.findById(userId);
  if (!user) throw notFound('Użytkownik nie istnieje');
  if (user.premium_tier === 'standard') throw badRequest('Subskrypcja Standard jest już aktywna');

  // 1) Walidacja BEZ zużycia — sprawdzamy istnienie, cel, ważność i właściciela.
  const ownerId = await magicLinks.peek(token, 'upgrade');
  if (!ownerId || ownerId !== userId) {
    throw badRequest('Link do subskrypcji jest nieprawidłowy lub wygasł');
  }
  if (!isStripeEnabled()) {
    throw serviceUnavailable('Płatności chwilowo niedostępne — skontaktuj się z obsługą');
  }

  // 2) Sesja Stripe. Gdyby rzuciła (błąd sieci / brak price), link NIE jest jeszcze zużyty.
  const session = await createCheckoutSession({
    user,
    successUrl: `${env.APP_URL}/upgrade/success`,
    cancelUrl: `${env.APP_URL}/upgrade/cancel`,
  });

  // 3) Sesja istnieje — teraz zużywamy link transakcyjnie i jednorazowo.
  const consumed = await consumeUpgradeLink(userId, token);
  if (!consumed) {
    // Ktoś zużył link równolegle między peek a consume (albo właśnie wygasł).
    // Sesja Stripe już powstała i jest ważna — nie przerywamy, tylko logujemy.
    logger.warn({ userId }, 'Link upgrade nie zużyty po utworzeniu sesji (równoległe zużycie lub wygaśnięcie)');
  }

  audit({ userId: user.id, action: 'checkout_started', ip: req.ip });
  logger.info({ userId: user.id, sessionId: session.id }, 'Utworzono sesję Stripe Checkout');
  return session;
}

/**
 * POST /upgrade — apka mobilna woła z user_id + token, dostaje checkout_url
 * w JSON i sama otwiera go w przeglądarce systemowej.
 */
router.post('/', ah(async (req, res) => {
  const result = upgradeSchema.safeParse(req.body);
  if (!result.success) throw badRequest('Wymagane pola: user_id, token');
  const session = await startCheckout({ userId: result.data.user_id, token: result.data.token, req });
  res.json({ checkout_url: session.url });
}));

/**
 * GET /upgrade?user_id=X&token=Y — wejście z magic linka w mailu.
 * Tworzy sesję Stripe i robi 303 redirect do strony płatności.
 * Bez tej trasy magic link by się wywalił, bo landingu już nie ma.
 */
router.get('/', ah(async (req, res) => {
  const result = upgradeSchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).type('html').send(pageError('Link do subskrypcji jest niekompletny — sprawdź, czy skopiowałeś cały adres z maila.'));
  }
  try {
    const session = await startCheckout({ userId: result.data.user_id, token: result.data.token, req });
    return res.redirect(303, session.url);
  } catch (err) {
    const status = typeof err.statusCode === 'number' ? err.statusCode : (typeof err.status === 'number' ? err.status : 500);
    return res.status(status).type('html').send(pageError(err.message || 'Coś poszło nie tak. Wróć do aplikacji i spróbuj ponownie.'));
  }
}));

/** GET /upgrade/success — Stripe redirectuje tu po udanej płatności. */
router.get('/success', (_req, res) => {
  res.type('html').send(pageSuccess());
});

/** GET /upgrade/cancel — Stripe redirectuje tu po anulowaniu. */
router.get('/cancel', (_req, res) => {
  res.type('html').send(pageCancel());
});

// === Minimalistyczne strony HTML (mobile-first, zero zależności, brak landingu) ===

function pageShell({ title, glyph, body, accent }) {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title} — PrzetargAI</title>
  <style>
    *,*::before,*::after { box-sizing: border-box; }
    html,body { margin: 0; }
    body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 10px 40px rgba(15,23,42,0.08); padding: 36px 28px; max-width: 420px; width: 100%; text-align: center; }
    .glyph { width: 64px; height: 64px; border-radius: 50%; background: ${accent}; color: #fff; font-size: 30px; font-weight: 700; line-height: 64px; margin: 0 auto 18px; }
    h1 { margin: 0 0 14px; font-size: 22px; }
    p { margin: 0 0 14px; line-height: 1.55; color: #475569; font-size: 15px; }
    .brand { margin-top: 26px; font-size: 13px; color: #94a3b8; letter-spacing: 0.04em; }
  </style>
</head>
<body>
  <main class="card">
    <div class="glyph" aria-hidden="true">${glyph}</div>
    <h1>${title}</h1>
    ${body}
    <p class="brand">PrzetargAI</p>
  </main>
</body>
</html>`;
}

function pageSuccess() {
  return pageShell({
    title: 'Subskrypcja aktywna',
    glyph: '✓',
    body: `<p>Twoja subskrypcja <strong>Standard</strong> została aktywowana. Fakturę dostaniesz e-mailem.</p>
           <p>Wróć do aplikacji PrzetargAI — odblokowane są nielimitowane dopasowania i powiadomienia push.</p>`,
    accent: '#16a34a',
  });
}

function pageCancel() {
  return pageShell({
    title: 'Płatność anulowana',
    glyph: '×',
    body: `<p>Nie została pobrana żadna opłata. Możesz spróbować ponownie z poziomu aplikacji w dowolnym momencie.</p>`,
    accent: '#dc2626',
  });
}

function pageError(message) {
  return pageShell({
    title: 'Coś poszło nie tak',
    glyph: '!',
    body: `<p>${message}</p>`,
    accent: '#dc2626',
  });
}

export default router;
