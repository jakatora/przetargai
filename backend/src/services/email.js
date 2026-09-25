import { Resend } from 'resend';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { jestAdresemMostu } from '../lib/mostPodpis.js';

const resend = features.email ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Escape'owanie wartości wstawianej do HTML maila (2026-09-25). `company_name` z publicznej
 * rejestracji trafiał do szablonu surowo — atakujący wpisywał link/formularz i dostawał
 * mail z NASZĄ marką na dowolny adres (phishing). Każde pole z zewnątrz idzie przez to.
 */
export function escapeHtml(wartosc) {
  return String(wartosc ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wysyła email transakcyjny przez Resend.
 * Bez RESEND_API_KEY działa w trybie degradacji (loguje treść, nie wysyła).
 */
export async function sendEmail({ to, subject, html, text }) {
  // Domena kont pomostowych nie istnieje — każdy mail tam to twarde odbicie w Resend,
  // które psuje reputację nadawcy dla prawdziwych klientów. Obrona w głąb: rejestracja
  // już go nie wysyła, ale reset hasła czy webhook też nie mogą (2026-09-25).
  if ([].concat(to).some((adres) => jestAdresemMostu(adres, env.MOST_EMAIL_DOMENA))) {
    logger.info({ subject }, 'Email pominięty — adres techniczny konta pomostowego');
    return { sent: false, pominiety: 'domena_mostu' };
  }
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
  const dlaKogo = companyName ? `dla <b>${escapeHtml(companyName)}</b> ` : '';
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
  const dlaKogo = companyName ? ` dla <b>${escapeHtml(companyName)}</b>` : '';
  return {
    subject: 'Subskrypcja PrzetargAI Standard jest aktywna',
    text: `Subskrypcja Standard${companyName ? ` dla ${companyName}` : ''} jest aktywna: nielimitowane dopasowania i powiadomienia push.`,
    html: `<p>Dzień dobry,</p>
<p>Subskrypcja <b>PrzetargAI Standard</b>${dlaKogo} jest aktywna.</p>
<p>Masz teraz nielimitowane dopasowania przetargów oraz powiadomienia push.</p>
<p>Zespół PrzetargAI</p>`,
  };
}

// Reset hasła — token wysyłamy jako KOD do wpisania w apce (bez zależności od deep-linków).
// Kod jest jednorazowy i ważny 1 h; treść nie ujawnia, czy konto istnieje (anty-enumeracja
// jest po stronie endpointu — mail idzie tylko do realnych kont).
export function resetPasswordEmail(token) {
  return {
    subject: 'Reset hasła w PrzetargAI',
    text: `Aby ustawić nowe hasło, wpisz w aplikacji ten kod:\n\n${token}\n\n`
      + `Kod jest ważny 1 godzinę i można go użyć raz. Jeśli to nie Ty prosiłeś o reset — `
      + `zignoruj tę wiadomość, nic się nie zmieni.`,
    html: `<p>Dzień dobry,</p>
<p>Aby ustawić nowe hasło, wpisz w aplikacji ten kod:</p>
<p style="font-size:15px;font-weight:bold;background:#f2f4f7;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace">${escapeHtml(token)}</p>
<p>Kod jest ważny <b>1 godzinę</b> i można go użyć raz. Jeśli to nie Ty prosiłeś o reset —
zignoruj tę wiadomość, nic się nie zmieni.</p>
<p>Zespół PrzetargAI</p>`,
  };
}
