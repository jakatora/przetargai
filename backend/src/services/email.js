import { Resend } from 'resend';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';

const resend = features.email ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Wysyła email transakcyjny przez Resend.
 * Bez RESEND_API_KEY działa w trybie degradacji (loguje treść, nie wysyła).
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!resend) {
    logger.warn({ to, subject }, 'Email pominięty — brak RESEND_API_KEY (tryb degradacji)');
    return { sent: false, degraded: true };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      logger.error({ error }, 'Resend zwrócił błąd');
      return { sent: false, error };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    logger.error({ err: err.message }, 'Wysyłka email nie powiodła się');
    return { sent: false, error: err.message };
  }
}

// ----- szablony -----

// Nazwa firmy jest opcjonalna (rejestracja bez NIP-u i nazwy — migracja 001),
// więc szablony muszą brzmieć naturalnie także bez niej.
export function welcomeEmail(companyName) {
  const dlaKogo = companyName ? `dla <b>${companyName}</b> ` : '';
  return {
    subject: 'Witamy w PrzetargAI',
    text: `Twoje konto ${companyName ? `dla ${companyName} ` : ''}zostało utworzone. Monitorujemy przetargi publiczne dopasowane do Twojego profilu.`,
    html: `<p>Dzień dobry,</p>
<p>Twoje konto ${dlaKogo}zostało utworzone. Od teraz monitorujemy
przetargi publiczne (BZP) dopasowane do Twojego profilu.</p>
<p>Zespół PrzetargAI</p>`,
  };
}

export function subscriptionActiveEmail(companyName) {
  const dlaKogo = companyName ? ` dla <b>${companyName}</b>` : '';
  return {
    subject: 'Subskrypcja PrzetargAI Standard jest aktywna',
    text: `Subskrypcja Standard${companyName ? ` dla ${companyName}` : ''} jest aktywna: nielimitowane dopasowania i powiadomienia push.`,
    html: `<p>Dzień dobry,</p>
<p>Subskrypcja <b>PrzetargAI Standard</b>${dlaKogo} jest aktywna.</p>
<p>Masz teraz nielimitowane dopasowania przetargów oraz powiadomienia push.</p>
<p>Zespół PrzetargAI</p>`,
  };
}
