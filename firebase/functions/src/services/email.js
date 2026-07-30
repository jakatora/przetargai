import { Resend } from 'resend';
import { env, features } from '../config.js';
import { logger } from '../lib/logger.js';
import { budujDigest } from '../lib/digestTresc.js';

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

// Cotygodniowy przegląd — treść w czystej `budujDigest` (testowana bez configu).
export function weeklyDigestEmail({ companyName, liczba, tytuly }) {
  return budujDigest({ companyName, liczba, tytuly });
}

// Reset hasła — token jako KOD do wpisania w apce (bez deep-linków). Jednorazowy, ważny 1 h.
export function resetPasswordEmail(token) {
  return {
    subject: 'Reset hasła w PrzetargAI',
    text: `Aby ustawić nowe hasło, wpisz w aplikacji ten kod:\n\n${token}\n\n`
      + `Kod jest ważny 1 godzinę i można go użyć raz. Jeśli to nie Ty prosiłeś o reset — `
      + `zignoruj tę wiadomość, nic się nie zmieni.`,
    html: `<p>Dzień dobry,</p>
<p>Aby ustawić nowe hasło, wpisz w aplikacji ten kod:</p>
<p style="font-size:15px;font-weight:bold;background:#f2f4f7;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace">${token}</p>
<p>Kod jest ważny <b>1 godzinę</b> i można go użyć raz. Jeśli to nie Ty prosiłeś o reset —
zignoruj tę wiadomość, nic się nie zmieni.</p>
<p>Zespół PrzetargAI</p>`,
  };
}
