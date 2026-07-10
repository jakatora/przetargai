import { env, features } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Cena katalogowa BRUTTO — używana TYLKO wtedy, gdy Stripe nie poda kwoty.
 * 49 zł/mc (decyzja usera 2026-07-10, D-042); Stripe pobiera kwotę brutto,
 * VAT 23% siedzi w środku (pozycja faktury liczy go z total_price_gross).
 */
const STANDARD_BRUTTO_PLN = 49;

/**
 * Kwota brutto faktury w złotych.
 *
 * Audyt 2026-07-10: kwota była zaszyta na sztywno (sztywna cena katalogowa). Klient z kodem
 * rabatowym płacił mniej, a fakturę dostawał na pełną cenę — zawyżony VAT i błąd
 * księgowy po obu stronach. Stripe podaje faktycznie pobraną kwotę w groszach
 * (`amount_total`); jego liczba jest jedyną prawdziwą.
 *
 * @param {number|null|undefined} amountTotalGrosze wartość `session.amount_total`
 * @returns {number} kwota brutto w złotych
 */
export function kwotaBruttoPln(amountTotalGrosze) {
  if (Number.isFinite(amountTotalGrosze) && amountTotalGrosze > 0) {
    return Number((amountTotalGrosze / 100).toFixed(2));
  }
  // Zapasowo cena katalogowa — lepsza faktura na 49 zł niż brak faktury.
  return STANDARD_BRUTTO_PLN;
}

/**
 * Wystawia fakturę VAT w Fakturowni za subskrypcję Standard.
 * Bez konfiguracji Fakturowni działa w trybie degradacji (loguje, nie wystawia).
 *
 * @param {{buyerName: string, buyerNip: string, buyerEmail: string,
 *          amountTotal?: number, opis?: string}} dane
 *   `amountTotal` — `session.amount_total` ze Stripe (w groszach).
 */
export async function createStandardInvoice({ buyerName, buyerNip, buyerEmail, amountTotal, opis }) {
  if (!features.invoicing) {
    logger.warn({ buyerNip }, 'Faktura pominięta — brak konfiguracji Fakturowni (tryb degradacji)');
    return { created: false, degraded: true };
  }

  const brutto = kwotaBruttoPln(amountTotal);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    api_token: env.FAKTUROWNIA_API_KEY,
    invoice: {
      kind: 'vat',
      sell_date: today,
      issue_date: today,
      payment_to: today,
      status: 'paid',
      buyer_name: buyerName,
      buyer_tax_no: buyerNip,
      buyer_email: buyerEmail,
      positions: [{
        name: opis ?? 'Subskrypcja PrzetargAI Standard (1 miesiąc)',
        tax: 23,
        total_price_gross: brutto,
        quantity: 1,
      }],
    },
  };

  try {
    const res = await fetch(`https://${env.FAKTUROWNIA_DOMAIN}/invoices.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body }, 'Fakturownia zwróciła błąd');
      return { created: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    logger.info({ invoiceId: data?.id, number: data?.number }, 'Faktura wystawiona');
    return { created: true, invoiceId: data?.id, number: data?.number };
  } catch (err) {
    logger.error({ err: err.message }, 'Wystawienie faktury nie powiodło się');
    return { created: false, error: err.message };
  }
}
