import Stripe from 'stripe';
import { env, features } from '../config.js';
import { serviceUnavailable } from '../lib/errors.js';
import { czyZywa } from '../lib/subscriptionStatus.js';
import { logger } from '../lib/logger.js';

const stripe = features.stripe ? new Stripe(env.STRIPE_SECRET_KEY) : null;

/*
 * Znacznik projektu na obiektach Stripe. Konto Stripe jest WSPÓLNE z Fitterem
 * (D-024), a webhook rozpoznaje cudze zdarzenia po `metadata.project` — dotąd
 * PrzetargAI nie oznaczał swoich obiektów wcale (2026-09-25).
 */
const PROJEKT = 'przetargai';

export function isStripeEnabled() {
  return Boolean(stripe);
}

/**
 * Zakłada klienta Stripe dla użytkownika — RAZ (2026-09-25, P2 „osierocona druga
 * subskrypcja").
 *
 * Dotąd sesja Checkout bez `stripe_customer_id` dostawała `customer_email`, więc
 * Stripe zakładał NOWEGO klienta przy każdej sesji. Dwie opłacone sesje dawały dwóch
 * klientów z dwiema subskrypcjami, a sprawdzenie „czy klient już płaci" nie miało
 * czego sprawdzić. Teraz klient powstaje przed pierwszą płatnością i jest zapisywany
 * przy koncie (zapis robi wołający — `users.ustawStripeCustomerJesliBrak`).
 *
 * Klucz idempotencji per użytkownik: dwa równoległe żądania /upgrade dostają od
 * Stripe TEGO SAMEGO klienta (Stripe pamięta klucz 24 h), zamiast założyć dwóch.
 *
 * @returns {Promise<string>} identyfikator klienta Stripe
 */
export async function utworzKlientaStripe(user) {
  if (!stripe) throw serviceUnavailable('Płatności niedostępne — brak konfiguracji Stripe');
  const klient = await stripe.customers.create(
    {
      email: user.email,
      ...(user.company_name ? { name: user.company_name } : {}),
      metadata: { user_id: user.id, project: PROJEKT },
    },
    { idempotencyKey: `${PROJEKT}-klient-${user.id}` },
  );
  return klient.id;
}

/**
 * Subskrypcje klienta, które POBIERAJĄ opłaty (active / trialing / past_due).
 *
 * Rzuca przy błędzie Stripe — świadomie: wołający (checkout) ma wtedy ODMÓWIĆ
 * (fail-closed). Lepiej, żeby klient spróbował za minutę, niż żeby zapłacił drugi raz.
 * Bez Stripe (testy, degradacja) zwraca pustą listę — nie ma czego sprawdzać.
 *
 * @returns {Promise<Array<{id: string, status: string, created?: number, metadata?: object}>>}
 */
export async function zyweSubskrypcjeKlienta(customerId) {
  if (!stripe || !customerId) return [];
  // Domyślna lista Stripe pomija `canceled`; resztę filtrujemy jedną regułą.
  const lista = await stripe.subscriptions.list({ customer: customerId, limit: 100 });
  return (lista?.data ?? []).filter((s) => czyZywa(s.status));
}

/**
 * Status JEDNEJ subskrypcji — do rozpoznania duplikatu w webhooku.
 *
 * @returns {Promise<string|null>} status Stripe; `null` = subskrypcja nie istnieje;
 *   `'nieznany'` = nie da się sprawdzić (brak Stripe / błąd API). Wołający traktuje
 *   „nieznany" jak żywą: fałszywy alarm kosztuje spojrzenie właściciela, przeoczony
 *   duplikat — comiesięczne podwójne obciążenie klienta.
 */
export async function statusSubskrypcji(subscriptionId) {
  if (!subscriptionId) return null;
  if (!stripe) return 'nieznany';
  try {
    const sub = await stripe.subscriptions.retrieve(String(subscriptionId));
    return sub?.status ?? 'nieznany';
  } catch (err) {
    if (err?.code === 'resource_missing') return null;
    logger.warn({ err: err.message, subscriptionId }, 'Nie udało się sprawdzić statusu subskrypcji w Stripe');
    return 'nieznany';
  }
}

/**
 * Wygasza OTWARTE (nieopłacone) sesje Checkout klienta przed utworzeniem nowej.
 *
 * Sprawdzenie „czy klient już płaci" widzi wyłącznie subskrypcje, a te powstają
 * dopiero PO płatności. Dwie karty przeglądarki z dwiema otwartymi sesjami przeszłyby
 * więc obie — i dały dwie subskrypcje. Wygaszona sesja nie przyjmie już płatności.
 * To NIE jest ruch pieniędzy: otwarta sesja nie ma jeszcze żadnej opłaty.
 *
 * Best-effort: błąd tylko logujemy — ostatnią linią obrony jest wykrycie duplikatu
 * w webhooku, a blokowanie zakupu przez chwilową awarię listy sesji byłoby przesadą.
 *
 * @returns {Promise<number>} liczba wygaszonych sesji
 */
export async function wygasOtwarteSesje(customerId) {
  if (!stripe || !customerId) return 0;
  try {
    const lista = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 20 });
    let wygaszone = 0;
    for (const sesja of lista?.data ?? []) {
      await stripe.checkout.sessions.expire(sesja.id);
      wygaszone++;
    }
    return wygaszone;
  } catch (err) {
    logger.warn({ err: err.message, customerId }, 'Nie udało się wygasić otwartych sesji Checkout klienta');
    return 0;
  }
}

/**
 * Tworzy sesję Stripe Checkout dla subskrypcji „PrzetargAI Standard".
 * Płatność odbywa się na landingu — zgodnie ze strategią iOS (bez IAP).
 *
 * `customerId` jest WYMAGANY (2026-09-25): sesja z samym `customer_email` zakładała
 * nowego klienta Stripe przy każdym zakupie — patrz `utworzKlientaStripe`.
 */
export async function createCheckoutSession({ user, customerId, successUrl, cancelUrl }) {
  if (!stripe) throw serviceUnavailable('Płatności niedostępne — brak konfiguracji Stripe');
  if (!env.STRIPE_PRICE_STANDARD) throw serviceUnavailable('Brak STRIPE_PRICE_STANDARD w konfiguracji');
  if (!customerId) throw new Error('createCheckoutSession: brak customerId — sesja założyłaby nowego klienta Stripe');

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: env.STRIPE_PRICE_STANDARD, quantity: 1 }],
    customer: customerId,
    client_reference_id: user.id,
    metadata: { user_id: user.id, company_nip: user.company_nip, project: PROJEKT },
    subscription_data: { metadata: { user_id: user.id, project: PROJEKT } },
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

/**
 * Zwraca `customer` (id klienta) dla danego obciążenia. Używane przy reklamacji
 * (obiekt `dispute` niesie zwykle sam identyfikator charge, bez klienta). Best-effort:
 * brak Stripe / błędne id → null, żeby webhook nie padał na rozpoznaniu klienta.
 */
export async function pobierzKlientaZCharge(chargeId) {
  if (!stripe || !chargeId) return null;
  try {
    const charge = await stripe.charges.retrieve(String(chargeId));
    return charge?.customer ?? null;
  } catch {
    return null;
  }
}

export { stripe };
