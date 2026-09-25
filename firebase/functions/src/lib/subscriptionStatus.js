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

/*
 * Statusy, w których subskrypcja OBCIĄŻA (albo zaraz obciąży) kartę klienta —
 * 2026-09-25, P2 „osierocona druga subskrypcja". Druga subskrypcja przy jednej z nich
 * to podwójna opłata co miesiąc, więc checkout jest wtedy blokowany, a webhook
 * zgłasza duplikat. `unpaid`/`paused`/`incomplete` NIE są tu celowo: Stripe ich nie
 * ściąga automatycznie (albo nie ściągnął jeszcze nic), a blokada zakupu na 23 h
 * po porzuconym 3-D Secure kosztowałaby klienta bez żadnej ochrony pieniędzy.
 */
export const ZYWE_STATUSY = new Set(['active', 'trialing', 'past_due']);

/** Czy subskrypcja o tym statusie pobiera opłaty (patrz ZYWE_STATUSY). */
export function czyZywa(status) {
  return ZYWE_STATUSY.has(status);
}
