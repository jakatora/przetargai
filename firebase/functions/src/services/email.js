import { Resend } from 'resend';
import { env, features } from '../config.js';
import { logger } from '../lib/logger.js';
import { budujDigest } from '../lib/digestTresc.js';
import { esc } from '../lib/html.js';

const resend = features.email ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Czy Resend odrzucił ADRES ODBIORCY (422 validation_error na polu `to`, np. domena
 * example.com). Ponowienie nic tu nie zmieni — w odróżnieniu od złego nadawcy
 * (`from`) czy awarii Resend, które dotyczą wszystkich i muszą być widoczne.
 */
export function czyOdrzuconyAdresat(error) {
  return error?.name === 'validation_error' && /`to`/.test(String(error?.message ?? ''));
}

/**
 * Wysyła email transakcyjny przez Resend.
 * Bez RESEND_API_KEY działa w trybie degradacji (loguje treść, nie wysyła).
 * `odrzuconyAdresat: true` = trwałe odrzucenie adresu (patrz czyOdrzuconyAdresat).
 */
export async function sendEmail({ to, subject, html, text, attachments }) {
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
      // Załączniki (eksport CSV, P2-3): [{ filename, content: Buffer }].
      ...(attachments?.length ? { attachments } : {}),
    });
    if (error) {
      if (czyOdrzuconyAdresat(error)) {
        logger.warn({ error }, 'Resend odrzucił adres odbiorcy');
        return { sent: false, error, odrzuconyAdresat: true };
      }
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
// KAŻDE pole w HTML przez esc() (2026-09-25): nazwa firmy `<a href="...">` renderowała
// się jako działający link w mailu z naszej domeny. Wersja `text` to nie HTML — bez encji.
export function welcomeEmail(companyName) {
  const dlaKogo = companyName ? `dla <b>${esc(companyName)}</b> ` : '';
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
  const dlaKogo = companyName ? ` dla <b>${esc(companyName)}</b>` : '';
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
<p style="font-size:15px;font-weight:bold;background:#f2f4f7;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace">${esc(token)}</p>
<p>Kod jest ważny <b>1 godzinę</b> i można go użyć raz. Jeśli to nie Ty prosiłeś o reset —
zignoruj tę wiadomość, nic się nie zmieni.</p>
<p>Zespół PrzetargAI</p>`,
  };
}

/*
 * Alarm operacyjny: AI przestało działać z powodu, który sam nie minie (2026-10-17).
 * Odbiorca to właściciel, nie użytkownik — treść może mówić wprost o kluczach i kredytach.
 */
const CO_ZROBIC_AI = {
  kredyty: 'Doładuj kredyty w konsoli Anthropic (console.anthropic.com → Plans & Billing).',
  autoryzacja: 'Sprawdź klucz ANTHROPIC_API_KEY w Secret Managerze projektu przetargai (odwołany, wygasły albo zły).',
};
const OPIS_AI = {
  kredyty: 'skończyły się kredyty Anthropic',
  autoryzacja: 'klucz Anthropic jest odrzucany',
};

export function alarmAiEmail({ typ, udane = 0, nieudane = 0, ostatniBlad = null, healthUrl }) {
  const opis = OPIS_AI[typ] ?? `błąd AI (${typ})`;
  const coZrobic = CO_ZROBIC_AI[typ] ?? 'Sprawdź logi funkcji dailyTenderFetch.';
  const komunikat = ostatniBlad?.komunikat ?? '(brak treści błędu)';
  return {
    subject: `PrzetargAI: ${opis} — oceny AI wyłączone`,
    text: `Dzisiejszy cykl dopasowań: ${nieudane} nieudanych ocen AI, ${udane} udanych.
`
      + `Dopasowania liczą się samą heurystyką, dopóki tego nie naprawisz.

`
      + `Co zrobić: ${coZrobic}

Ostatni błąd: ${komunikat}

Stan: ${healthUrl}

`
      + 'Ten alarm przychodzi najwyżej raz na dobę, dopóki problem trwa.',
    html: `<p><b>${esc(opis)}</b> — dzisiejszy cykl dopasowań: ${Number(nieudane)} nieudanych ocen AI,
${Number(udane)} udanych. Dopasowania liczą się samą heurystyką, dopóki tego nie naprawisz.</p>
<p><b>Co zrobić:</b> ${esc(coZrobic)}</p>
<p>Ostatni błąd:</p>
<p style="font-family:monospace;background:#f2f4f7;padding:12px;border-radius:8px;word-break:break-word">${esc(komunikat)}</p>
<p>Stan: <a href="${esc(healthUrl)}">${esc(healthUrl)}</a></p>
<p style="color:#667085">Ten alarm przychodzi najwyżej raz na dobę, dopóki problem trwa.</p>`,
  };
}
