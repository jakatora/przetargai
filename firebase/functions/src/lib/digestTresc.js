/**
 * Treść cotygodniowego przeglądu (digest e-mail). Czysta funkcja — bez sieci i
 * bez configu, żeby dała się przetestować bez emulatora i bez ładowania sekretów.
 * Job `weeklyDigest.js` liczy dane, a `email.js` opakowuje to w wysyłkę.
 */

// Ucieczka znaków HTML — tytuły przetargów pochodzą z zewnętrznych rejestrów,
// nazwa firmy od użytkownika. Wspólny helper (2026-09-25, dokłada apostrof).
import { esc } from './html.js';

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
const kwotaKrotko = (n) => (!Number.isFinite(n) ? null
  : n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} mln zł` : n >= 1e3 ? `${Math.round(n / 1e3)} tys. zł` : `${Math.round(n)} zł`);
const opisWygranej = (k) => [k.tytul, k.zamawiajacy, kwotaKrotko(k.cena)].filter(Boolean).join(' · ');

const dataPL = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : null; };
/** Termin ofert następcy po polsku (czas warszawski — północ zapisana w UTC to poprzedni dzień). */
const terminPL = (iso) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }) : null; };
/** Następca umowy (2026-11-01): nowy przetarg już ogłoszony — wtedy nie „zaraz wróci”, tylko „składaj”. */
const opisNastepcy = (n) => (!n ? null
  : `${n.pewny === false ? 'podobny przetarg' : 'nowy przetarg'} już ogłoszony${terminPL(n.deadline) ? `, oferty do ${terminPL(n.deadline)}` : ''}`);
const opisUmowy = (u) => [u.zamawiajacy, dataPL(u.koniec) ? `koniec ${dataPL(u.koniec)}` : null, kwotaKrotko(u.wartosc), opisNastepcy(u.nastepca)].filter(Boolean).join(' · ');

export function budujDigest({ companyName = null, liczba = 0, tytuly = [], konkurenci = [], umowy = [] }) {
  const n = Math.max(0, Math.floor(liczba));
  const rzeczownik = odmienPrzetargi(n);
  const subject = `Twój tygodniowy przegląd: ${n} ${rzeczownik}`;
  const dlaKogo = companyName ? ` dla ${companyName}` : '';
  const lista = Array.isArray(tytuly) ? tytuly.filter(Boolean).slice(0, 5) : [];

  const wstepText = `W ostatnim tygodniu dopasowaliśmy${dlaKogo} ${n} ${rzeczownik}.`;
  const tytulyText = lista.length
    ? `\n\nNa przykład:\n${lista.map((t) => `• ${t}`).join('\n')}`
    : '';
  // Co wygrali Twoi konkurenci (2026-10-31) — z rozstrzygnięć BZP z tego tygodnia.
  const wygrane = Array.isArray(konkurenci) ? konkurenci.filter((k) => k?.nazwa).slice(0, 5) : [];
  const konkurenciText = wygrane.length
    ? `\n\nCo w tym tygodniu wygrali Twoi konkurenci:\n${wygrane.map((k) => `• ${k.nazwa} — ${opisWygranej(k)}`).join('\n')}`
    : '';
  const konkurenciHtml = wygrane.length
    ? `<p>Co w tym tygodniu wygrali <b>Twoi konkurenci</b>:</p><ul>${wygrane.map((k) => `<li><b>${esc(k.nazwa)}</b> — ${esc(opisWygranej(k))}</li>`).join('')}</ul>`
    : '';
  // Wygasające umowy (2026-10-31) — przetargi, które za chwilę wrócą w branżach i regionach karty.
  const konczace = Array.isArray(umowy) ? umowy.filter((u) => u?.tytul).slice(0, 3) : [];
  const zapowiedz = konczace.some((u) => u.nastepca) ? 'część przetargów już ogłoszono' : 'ten przetarg zaraz wróci';
  const umowyText = konczace.length
    ? `\n\nUmowy w Twoich branżach, które wkrótce się kończą — ${zapowiedz}:\n${konczace.map((u) => `• ${u.tytul} — ${opisUmowy(u)}`).join('\n')}`
    : '';
  const umowyHtml = konczace.length
    ? `<p>Umowy w Twoich branżach, które <b>wkrótce się kończą</b> — ${zapowiedz}:</p><ul>${konczace.map((u) => `<li><b>${esc(u.tytul)}</b> — ${esc(opisUmowy(u))}</li>`).join('')}</ul>`
    : '';
  const text = `Dzień dobry,\n\n${wstepText}${tytulyText}${konkurenciText}${umowyText}\n\n`
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
${konkurenciHtml}
${umowyHtml}
<p>Otwórz aplikację <b>PrzetargAI</b>, aby zobaczyć szczegóły i zdecydować, w które startujesz.</p>
<p>Zespół PrzetargAI</p>
<p style="font-size:12px;color:#667085">Nie chcesz tego podsumowania? Odpisz na tę wiadomość, a wyłączymy je dla Twojego konta.</p>`;

  return { subject, text, html };
}
