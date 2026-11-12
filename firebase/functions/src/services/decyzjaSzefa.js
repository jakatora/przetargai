import { env } from '../config.js';
import { magicLinks } from '../db/repos.js';

/*
 * „WYŚLIJ SZEFOWI DO DECYZJI” (2026-11-12, etap 0 pracy zespołowej — docs/backlog-praca-zespolowa.md).
 * Przetargi w małej firmie „ogarnia” jedna osoba z biura, a o starcie decyduje szef, który apki nie ma.
 * Pracownik wysyła mu link (WhatsApp, SMS, mail — systemowe udostępnianie w apce): strona pokazuje przetarg,
 * termin, wartość i powody wyboru, a szef odpowiada jednym przyciskiem. Odpowiedź wraca do konta pracownika
 * (alert + push); „Startujemy” od razu zapisuje przetarg z przypomnieniami i etapem „Przygotowuję ofertę”.
 *
 * Link: 7 dni, wielokrotny (szef może zmienić zdanie), ale PRZYPIĘTY do jednego dopasowania — cel linku zawiera
 * id dopasowania, więc podmiana `m=` w adresie na inny przetarg tego konta nie przejdzie. Link nie daje nic
 * poza obejrzeniem tego jednego przetargu i decyzją.
 */
export const DECYZJA_TTL_MIN = 7 * 24 * 60;
export const celDecyzji = (matchId) => `decyzja_szefa:${matchId}`;

export async function linkDecyzji(userId, matchId, { linki = magicLinks } = {}) {
  const { token, expiresAt } = await linki.create({ userId, purpose: celDecyzji(matchId), ttlMinutes: DECYZJA_TTL_MIN });
  return { url: `${env.APP_URL}/maile/decyzja?token=${token}&m=${encodeURIComponent(matchId)}`, wazny_do: expiresAt };
}

export const dataDecyzjiPL = (iso) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
};

/** Gotowa wiadomość do wysłania szefowi (apka podaje ją systemowemu udostępnianiu). */
export function wiadomoscDoSzefa({ row, url }) {
  const termin = dataDecyzjiPL(row.tender_deadline);
  return [
    `Do decyzji: ${row.tender_title}`,
    row.tender_organization ? `Zamawiający: ${row.tender_organization}` : null,
    termin ? `Termin ofert: ${termin}` : null,
    `Startujemy? Odpowiedz jednym kliknięciem: ${url}`,
  ].filter(Boolean).join('\n');
}

/** Alert dla pracownika po decyzji szefa. Klucz z chwilą decyzji — zmiana zdania budzi ponownie. */
export function alertDecyzjiSzefa({ row, decyzja, teraz }) {
  const tytul = String(row.tender_title ?? 'przetarg').slice(0, 90);
  const tak = decyzja === 'tak';
  return {
    klucz: `decyzja_${String(row.id).replace(/[/\s:.]/g, '_')}_${String(teraz).replace(/[^0-9]/g, '').slice(0, 14)}`,
    typ: 'zmiany',
    tender_id: row.tender_id ?? row.id,
    ton: tak ? 'neutral' : 'ostrzezenie',
    tytul: { pl: `${tak ? 'Szef: startujemy' : 'Szef: nie startujemy'} — ${tytul}`, en: `${tak ? 'Boss: we bid' : 'Boss: we pass'} — ${tytul}` },
    tresc: tak
      ? { pl: 'Decyzja z linku „do decyzji”. Przetarg jest w Zapisanych z przypomnieniami 7, 3 i 1 dzień przed terminem i etapem „Przygotowuję ofertę”.', en: 'Decision from the “for decision” link. The tender is saved with 7/3/1-day reminders and the “Preparing the bid” stage.' }
      : { pl: 'Decyzja z linku „do decyzji”. Przetarg zostaje na liście — odrzuć go przyciskiem „Nie dla nas”, żeby aplikacja uczyła się z przyczyny.', en: 'Decision from the “for decision” link. The tender stays on your list — reject it with “Not for us” so the app learns from the reason.' },
    pozycje: [{ tender_id: row.tender_id ?? row.id, tytul: row.tender_title ?? null, organizacja: row.tender_organization ?? null, deadline: row.tender_deadline ?? null, zrodlo: row.tender_source ?? 'bzp' }],
  };
}
