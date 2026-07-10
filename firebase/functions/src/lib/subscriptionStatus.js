/**
 * Reguły biznesowe: kto ma opłacony dostęp. Czyste funkcje, testowalne bez Stripe.
 *
 * Audyt 2026-07-10: test tych reguł trzymał WŁASNĄ kopię tabeli decyzyjnej, więc
 * przechodził także wtedy, gdy webhook decydował inaczej. Reguła mieszka teraz
 * w jednym miejscu i jest importowana i przez kod, i przez test.
 */

/**
 * Statusy Stripe, które ODBIERAJĄ dostęp. Reszta (active, trialing, past_due)
 * dostęp zachowuje: przy `past_due` Stripe wciąż ponawia obciążenie karty,
 * a odcinanie po pierwszej nieudanej próbie kosztuje więcej klientów, niż oszczędza.
 * Gdy Stripe się poddaje, przestawia subskrypcję na `unpaid` albo `canceled`.
 */
export const BEZ_DOSTEPU = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);

/**
 * Plan PrzetargAI na podstawie statusu subskrypcji Stripe.
 * @param {string} status
 * @returns {'standard'|'free'}
 */
export function tierPrzetargAi(status) {
  return BEZ_DOSTEPU.has(status) ? 'free' : 'standard';
}
