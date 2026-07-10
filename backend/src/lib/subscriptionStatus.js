/**
 * Reguły biznesowe: kto ma opłacony dostęp. Czyste funkcje, testowalne bez Stripe.
 *
 * Wydzielone z routes/webhooks.js po audycie 2026-07-09 — logika „kto płaci"
 * nie powinna mieszkać w obsłudze zdarzenia HTTP, bo nikt jej tam nie przetestuje.
 */

/** Statusy dozwolone przez CHECK w schema.sql (kolumna fitter_premium.status). */
const STATUSY_FITTERA = new Set(['active', 'canceled', 'past_due', 'unpaid']);

/**
 * Statusy Stripe, które ODBIERAJĄ dostęp. Reszta (active, trialing, past_due)
 * dostęp zachowuje: przy `past_due` Stripe wciąż ponawia obciążenie karty,
 * a odcinanie po pierwszej nieudanej próbie kosztuje więcej klientów, niż oszczędza.
 */
const BEZ_DOSTEPU = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);

/**
 * Status Premium Fittera na podstawie obiektu subskrypcji Stripe.
 *
 * `cancel_at_period_end` to ZAPOWIEDŹ, nie fakt: klient zapłacił do końca okresu
 * i ma prawo korzystać. Dostęp odbiera dopiero `customer.subscription.deleted`
 * albo status odmawiający dostępu. Wcześniej flaga natychmiast dawała 'canceled',
 * więc klient tracił Premium w dniu kliknięcia „nie odnawiaj".
 *
 * Wynik jest zawsze jednym z czterech statusów dopuszczonych przez CHECK w bazie —
 * Stripe zna też `trialing`, `incomplete` i `paused`, których zapis rzuciłby
 * wyjątkiem w środku webhooka.
 *
 * @param {{status?: string, cancel_at_period_end?: boolean}} sub
 * @returns {'active'|'canceled'|'past_due'|'unpaid'}
 */
export function statusSubskrypcjiFittera(sub) {
  const status = sub?.status;
  if (!status) return 'active'; // brak informacji: nie karzemy płacącego
  if (STATUSY_FITTERA.has(status)) return status;
  // Statusy Stripe spoza naszego zbioru: mapujemy po tym, czy dają dostęp.
  return BEZ_DOSTEPU.has(status) ? 'canceled' : 'active';
}

/**
 * Plan PrzetargAI na podstawie statusu subskrypcji Stripe.
 * @param {string} status
 * @returns {'standard'|'free'}
 */
export function tierPrzetargAi(status) {
  return BEZ_DOSTEPU.has(status) ? 'free' : 'standard';
}
