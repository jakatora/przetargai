import Stripe from 'stripe';
import { env, features } from '../config.js';
import { serviceUnavailable } from '../lib/errors.js';

const stripe = features.stripe ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export function isStripeEnabled() {
  return Boolean(stripe);
}

/**
 * Tworzy sesję Stripe Checkout dla subskrypcji „PrzetargAI Standard".
 * Płatność odbywa się na landingu — zgodnie ze strategią iOS (bez IAP).
 */
export async function createCheckoutSession({ user, successUrl, cancelUrl }) {
  if (!stripe) throw serviceUnavailable('Płatności niedostępne — brak konfiguracji Stripe');
  if (!env.STRIPE_PRICE_STANDARD) throw serviceUnavailable('Brak STRIPE_PRICE_STANDARD w konfiguracji');

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: env.STRIPE_PRICE_STANDARD, quantity: 1 }],
    customer: user.stripe_customer_id || undefined,
    customer_email: user.stripe_customer_id ? undefined : user.email,
    client_reference_id: user.id,
    metadata: { user_id: user.id, company_nip: user.company_nip },
    subscription_data: { metadata: { user_id: user.id } },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });
}

/** Weryfikuje podpis webhooka Stripe i zwraca zdarzenie. */
export function constructWebhookEvent(rawBody, signature) {
  if (!stripe) throw serviceUnavailable('Stripe niedostępny');
  if (!env.STRIPE_WEBHOOK_SECRET) throw serviceUnavailable('Brak STRIPE_WEBHOOK_SECRET');
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Anuluje subskrypcję NATYCHMIAST (nie czekając na koniec okresu rozliczeniowego).
 *
 * Używane przy usuwaniu konta: bez tego Stripe obciążałby kartę za konto, którego
 * już nie ma, a klient nie miałby jak tego zatrzymać (audyt 2026-07-10). Wcześniej
 * usuwanie konta było po prostu ZABLOKOWANE dla subskrybentów — a RODO art. 17
 * i wymóg Google Play nie znają wyjątku „bo płaci".
 *
 * Brak subskrypcji albo już anulowana to NIE błąd: usunięcie konta ma się udać
 * także wtedy, gdy Stripe zdążył ją zamknąć wcześniej.
 *
 * @returns {Promise<boolean>} czy subskrypcja została anulowana tym wywołaniem
 */
export async function anulujSubskrypcje(subscriptionId) {
  if (!stripe || !subscriptionId) return false;
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return true;
  } catch (err) {
    // 'resource_missing' = subskrypcja już nie istnieje; nic do zrobienia.
    if (err?.code === 'resource_missing') return false;
    throw err;
  }
}

/**
 * Rezygnacja INICJOWANA PRZEZ UŻYTKOWNIKA: planuje anulowanie na KONIEC opłaconego
 * okresu (`cancel_at_period_end`). Klient zapłacił za bieżący miesiąc i zachowuje
 * dostęp do jego końca — dopiero wtedy Stripe wyśle `customer.subscription.deleted`,
 * które w webhooku przełącza plan na Free. Świadomie NIE anulujemy natychmiast (to
 * robi `anulujSubskrypcje` tylko przy usuwaniu konta), żeby nie „zjeść" opłaconego
 * okresu.
 *
 * To NIE jest wyprowadzanie pieniędzy (żadnego payout/transfer/refund) — czysta
 * zmiana harmonogramu subskrypcji, dozwolona autonomicznie.
 *
 * @param {string} subscriptionId
 * @returns {Promise<{zaplanowana: boolean, koniecOkresuMs: number|null}>}
 */
export async function zaplanujAnulowanieNaKoniecOkresu(subscriptionId) {
  if (!stripe || !subscriptionId) return { zaplanowana: false, koniecOkresuMs: null };
  try {
    const sub = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    const koniec = typeof sub.current_period_end === 'number' ? sub.current_period_end * 1000 : null;
    return { zaplanowana: true, koniecOkresuMs: koniec };
  } catch (err) {
    // Subskrypcja już nie istnieje → traktujemy jak brak czego anulować, nie błąd.
    if (err?.code === 'resource_missing') return { zaplanowana: false, koniecOkresuMs: null };
    throw err;
  }
}

export { stripe };
