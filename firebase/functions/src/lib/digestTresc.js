/**
 * Treść cotygodniowego przeglądu (digest e-mail). Czysta funkcja — bez sieci i
 * bez configu, żeby dała się przetestować bez emulatora i bez ładowania sekretów.
 * Job `weeklyDigest.js` liczy dane, a `email.js` opakowuje to w wysyłkę.
 */

/** Ucieczka znaków HTML — tytuły przetargów pochodzą z zewnętrznych rejestrów. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Poprawna polska odmiana: 1 przetarg / 2–4 przetargi / 5+ przetargów. */
export function odmienPrzetargi(n) {
  const abs = Math.abs(n);
  if (abs === 1) return 'przetarg';
  const dziesiatki = abs % 100;
  const jednosci = abs % 10;
  if (jednosci >= 2 && jednosci <= 4 && !(dziesiatki >= 12 && dziesiatki <= 14)) return 'przetargi';
  return 'przetargów';
}

/**
 * Buduje temat i treść (text + html) tygodniowego przeglądu.
 *
 * @param {{companyName?: string|null, liczba: number, tytuly?: string[]}} dane
 * @returns {{subject: string, text: string, html: string}}
 */
export function budujDigest({ companyName = null, liczba = 0, tytuly = [] }) {
  const n = Math.max(0, Math.floor(liczba));
  const rzeczownik = odmienPrzetargi(n);
  const subject = `Twój tygodniowy przegląd: ${n} ${rzeczownik}`;
  const dlaKogo = companyName ? ` dla ${companyName}` : '';
  const lista = Array.isArray(tytuly) ? tytuly.filter(Boolean).slice(0, 5) : [];

  const wstepText = `W ostatnim tygodniu dopasowaliśmy${dlaKogo} ${n} ${rzeczownik}.`;
  const tytulyText = lista.length
    ? `\n\nNa przykład:\n${lista.map((t) => `• ${t}`).join('\n')}`
    : '';
  const text = `Dzień dobry,\n\n${wstepText}${tytulyText}\n\n`
    + `Otwórz aplikację PrzetargAI, aby zobaczyć szczegóły i zdecydować, w które startujesz.\n\n`
    + `Zespół PrzetargAI\n\n`
    + `Nie chcesz tego podsumowania? Odpisz na tę wiadomość, a wyłączymy je dla Twojego konta.`;

  const wstepHtml = `<p>W ostatnim tygodniu dopasowaliśmy${companyName ? ` dla <b>${esc(companyName)}</b>` : ''} <b>${n} ${rzeczownik}</b>.</p>`;
  const tytulyHtml = lista.length
    ? `<p>Na przykład:</p><ul>${lista.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';
  const html = `<p>Dzień dobry,</p>
${wstepHtml}
${tytulyHtml}
<p>Otwórz aplikację <b>PrzetargAI</b>, aby zobaczyć szczegóły i zdecydować, w które startujesz.</p>
<p>Zespół PrzetargAI</p>
<p style="font-size:12px;color:#667085">Nie chcesz tego podsumowania? Odpisz na tę wiadomość, a wyłączymy je dla Twojego konta.</p>`;

  return { subject, text, html };
}
