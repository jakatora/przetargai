import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';

const STANDARD_BRUTTO_PLN = 49; // 49 zl/mc brutto (D-042); VAT 23% w srodku

/**
 * Wystawia fakturę VAT w Fakturowni za subskrypcję Standard.
 * Bez konfiguracji Fakturowni działa w trybie degradacji (loguje, nie wystawia).
 */
export async function createStandardInvoice({ buyerName, buyerNip, buyerEmail }) {
  if (!features.invoicing) {
    logger.warn({ buyerNip }, 'Faktura pominięta — brak konfiguracji Fakturowni (tryb degradacji)');
    return { created: false, degraded: true };
  }

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
        name: 'Subskrypcja PrzetargAI Standard (1 miesiąc)',
        tax: 23,
        total_price_gross: STANDARD_BRUTTO_PLN,
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
