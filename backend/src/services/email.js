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

export function welcomeEmail(companyName) {
  return {
    subject: 'Witamy w PrzetargAI',
    text: `Konto dla ${companyName} zostało utworzone. Monitorujemy przetargi publiczne dopasowane do profilu Twojej firmy.`,
    html: `<p>Dzień dobry,</p>
<p>Konto dla <b>${companyName}</b> zostało utworzone. Od teraz monitorujemy
przetargi publiczne (BZP) dopasowane do profilu Twojej firmy.</p>
<p>Zespół PrzetargAI</p>`,
  };
}

export function subscriptionActiveEmail(companyName) {
  return {
    subject: 'Subskrypcja PrzetargAI Standard jest aktywna',
    text: `Subskrypcja Standard dla ${companyName} jest aktywna: nielimitowane dopasowania i powiadomienia push.`,
    html: `<p>Dzień dobry,</p>
<p>Subskrypcja <b>PrzetargAI Standard</b> dla <b>${companyName}</b> jest aktywna.</p>
<p>Masz teraz nielimitowane dopasowania przetargów oraz powiadomienia push.</p>
<p>Zespół PrzetargAI</p>`,
  };
}
