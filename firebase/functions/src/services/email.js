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
export function weeklyDigestEmail({ companyName, liczba, tytuly, konkurenci = [], umowy = [], dokumenty = [], wyniki = [], podwykonawstwo = [] }) {
  return budujDigest({ companyName, liczba, tytuly, konkurenci, umowy, dokumenty, wyniki, podwykonawstwo });
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

/** Alarm „źródło cicho puste" — BZP/TED bez surowych ogłoszeń w dzień roboczy mimo `ok`. */
/**
 * Przypomnienie o terminie składania ofert E-MAILEM (2026-10-24) — awaryjnie, gdy użytkownik
 * nie ma tokena push albo token jest martwy. Push nie działa dziś nigdzie (brak kluczy FCM/APNs),
 * więc bez tego przypomnienia o terminach po prostu nie docierały.
 */
export function przypomnienieTerminuEmail({ etap, tytul, termin, organizacja = null }) {
  const kiedy = etap === 7 ? 'Zostało 7 dni' : etap === 3 ? 'Zostały 3 dni' : etap === 1 ? 'Został 1 dzień' : 'Termin już blisko';
  const data = termin ? new Date(termin) : null;
  const terminTekst = data && !Number.isNaN(data.getTime())
    ? data.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const nazwa = tytul || 'Zapisany przetarg';
  return {
    subject: `PrzetargAI: ${kiedy} — ${nazwa}`,
    text: `${kiedy} do składania ofert.\n\n${nazwa}${organizacja ? `\n${organizacja}` : ''}${terminTekst ? `\nTermin: ${terminTekst}` : ''}\n\n`
      + 'Otwórz aplikację: „Krok po kroku do wygranej" pokaże, co zostało do zrobienia, a „Dokumenty do oferty w 1 klik" złoży oświadczenia.\n\n'
      + 'To przypomnienie przyszło mailem, bo powiadomienia push nie są włączone na Twoim telefonie.',
    html: `<p><b>${esc(kiedy)}</b> do składania ofert.</p><p><b>${esc(nazwa)}</b>${organizacja ? `<br>${esc(organizacja)}` : ''}${terminTekst ? `<br>Termin: ${esc(terminTekst)}` : ''}</p>`
      + '<p>Otwórz aplikację: „Krok po kroku do wygranej" pokaże, co zostało do zrobienia, a „Dokumenty do oferty w 1 klik" złoży oświadczenia.</p>'
      + '<p style="color:#666">To przypomnienie przyszło mailem, bo powiadomienia push nie są włączone na Twoim telefonie.</p>',
  };
}

/** Strażnik zdrowia (2026-10-29): problem trwa co najmniej dwa pomiary (≥ 1 h). */
export function alarmZdrowiaEmail({ powody = [], healthUrl }) {
  const lista = powody.map((p) => p.opis);
  const coZrobic = {
    api: 'Sprawdź, czy funkcja api działa (Cloud Run: najnowsza rewizja gotowa i z ruchem) i czy nie trwa wdrożenie.',
    baza: 'Sprawdź status Firestore w konsoli Firebase i logi funkcji api.',
    cykl: 'Sprawdź Cloud Scheduler (firebase-schedule-dailyTenderFetch) i logi dailyTenderFetch — 27.10 przyczyną było „no available instance”. Można wyzwolić zadanie ręcznie.',
    zrodla: 'Sprawdź, czy rejestr (e-Zamówienia / TED / BK) nie ma przerwy technicznej; okna dociągną dane po jej końcu.',
    ai: 'Sprawdź kredyty i klucz Anthropic (PRZETARGAI_ANTHROPIC_API_KEY) oraz logi dailyTenderFetch.',
    push: 'Sprawdź poświadczenia push w Expo (FCM v1 dla Androida, APNs dla iOS) — „InvalidCredentials” = brak klucza.',
    auto_swz: 'Sprawdź logi autoSwzFetch i dostępność backendu Railway (most).',
    status: 'Otwórz /health i sprawdź, która część zgłasza problem.',
  };
  const kroki = [...new Set(powody.map((p) => coZrobic[p.kod] ?? coZrobic.status))];
  return {
    subject: `PrzetargAI: problem na produkcji — ${powody.map((p) => p.kod).join(', ')}`,
    text: `Strażnik zdrowia widzi problem od co najmniej godziny:\n${lista.map((l) => `• ${l}`).join('\n')}\n\n`
      + `Co zrobić:\n${kroki.map((k) => `• ${k}`).join('\n')}\n\nStan: ${healthUrl}\n\n`
      + 'Ten sam zestaw problemów zgłaszam najwyżej raz na dobę.',
    html: `<p>Strażnik zdrowia widzi problem od co najmniej godziny:</p><ul>${lista.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      + `<p><b>Co zrobić:</b></p><ul>${kroki.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>`
      + `<p>Stan: <a href="${esc(healthUrl)}">${esc(healthUrl)}</a></p><p>Ten sam zestaw problemów zgłaszam najwyżej raz na dobę.</p>`,
  };
}

export function alarmZrodlaEmail({ zrodla = [], healthUrl }) {
  const lista = zrodla.map((z) => z.toUpperCase()).join(', ');
  return {
    subject: `PrzetargAI: ${lista} nie dało dziś ANI JEDNEGO ogłoszenia`,
    text: `Dzisiejszy cykl pobierania zakończył się „ok", ale źródło ${lista} zwróciło zero surowych ogłoszeń w dzień roboczy. `
      + 'To nie jest normalne (BZP publikuje kilkaset dziennie) — zwykle przerwa techniczna e-Zamówienia (403 HTML) albo zmiana API.\n\n'
      + 'Co zrobić: wejdź na https://ezamowienia.gov.pl — jeśli widzisz „Przerwa techniczna", nic nie rób, okno dociągnie dane po jej końcu. '
      + 'Jeśli serwis działa, sprawdź logi funkcji bzpOknoFetch / dailyTenderFetch (zmiana schematu albo adresu API).\n\n'
      + `Stan: ${healthUrl}\n\nTen alarm przychodzi najwyżej raz na dobę, dopóki problem trwa.`,
    html: `<p><b>${esc(lista)}</b> zwróciło dziś zero surowych ogłoszeń w dzień roboczy, choć cykl zakończył się „ok". `
      + 'To nie jest normalne (BZP publikuje kilkaset dziennie) — zwykle przerwa techniczna e-Zamówienia (403 HTML) albo zmiana API.</p>'
      + '<p><b>Co zrobić:</b> wejdź na <a href="https://ezamowienia.gov.pl">ezamowienia.gov.pl</a> — przy „Przerwie technicznej" nic nie rób, okno dociągnie dane po jej końcu. '
      + 'Jeśli serwis działa, sprawdź logi bzpOknoFetch / dailyTenderFetch.</p>'
      + `<p>Stan: <a href="${esc(healthUrl)}">${esc(healthUrl)}</a></p><p>Ten alarm przychodzi najwyżej raz na dobę, dopóki problem trwa.</p>`,
  };
}

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
