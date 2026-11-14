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

/** „Zostało 5 dni” / „termin dziś” / „termin jutro”; null po terminie albo bez terminu. */
export function zostaloDni(iso, teraz = Date.now()) {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t) || t <= teraz) return null;
  // Dni KALENDARZOWE w Polsce (QA 2026-11-13): 20:00 dziś → jutro 10:00 to „jutro”, nie „dziś”.
  const dzien = (ms) => Date.parse(`${new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' })}T00:00:00Z`);
  const dni = Math.round((dzien(t) - dzien(teraz)) / 86_400_000);
  return dni === 0 ? 'termin dziś' : dni === 1 ? 'termin jutro' : `${dni} dni`;
}

/** Wadium z kopii przetargu na dopasowaniu: kwota, „wymagane” bez kwoty, „bez wadium” albo null (nie wiadomo). */
export function opisWadium(row) {
  const kwota = Number(row?.tender_wadium_kwota);
  if (kwota > 0) return `${Math.round(kwota).toLocaleString('pl-PL')} zł${row.tender_wadium_wiele_czesci ? ' (łącznie za części)' : ''}`;
  if (row?.tender_wadium_wymagane === true) return 'wymagane — kwota w SWZ';
  if (row?.tender_wadium_wymagane === false) return 'bez wadium';
  return null;
}

export const kwotaZamowienia = (row) => (Number(row?.tender_budget) > 0
  ? `${Math.round(Number(row.tender_budget)).toLocaleString('pl-PL')} ${row.tender_currency ?? 'PLN'}` : null);

/** Gotowa wiadomość do wysłania szefowi (apka podaje ją systemowemu udostępnianiu). */
export function wiadomoscDoSzefa({ row, url }) {
  const termin = dataDecyzjiPL(row.tender_deadline);
  return [
    `Do decyzji: ${row.tender_title}`,
    row.tender_organization ? `Zamawiający: ${row.tender_organization}` : null,
    termin ? `Termin ofert: ${termin}` : null,
    kwotaZamowienia(row) ? `Wartość: ${kwotaZamowienia(row)}` : null,
    opisWadium(row) ? `Wadium: ${opisWadium(row)}` : null,
    `Startujemy? Odpowiedz jednym kliknięciem: ${url}`,
  ].filter(Boolean).join('\n');
}

/** Alert dla pracownika po decyzji szefa. Klucz z chwilą decyzji — zmiana zdania budzi ponownie. */
export function alertDecyzjiSzefa({ row, decyzja, komentarz = null, teraz, nr = null, wynik = null }) {
  const tytul = String(row.tender_title ?? 'przetarg').slice(0, 90);
  const tak = decyzja === 'tak';
  // Treść z FAKTYCZNEGO wyniku (QA 2026-11-13): nie obiecujemy przypomnień po terminie ani etapu, który nie został zmieniony.
  const skutek = wynik ?? { przypomnienie: true, etap: 'przygotowuje' };
  const coZrobione = [
    'Przetarg jest w Zapisanych',
    skutek.przypomnienie ? ' z przypomnieniami 7, 3 i 1 dzień przed terminem' : '',
    skutek.etap === 'przygotowuje' ? ' i etapem „Przygotowuję ofertę”' : '',
    '.',
  ].join('');
  const notatka = komentarz ? { pl: `Notatka: „${komentarz}”. `, en: `Note: “${komentarz}”. ` } : { pl: '', en: '' };
  return {
    // Klucz z numerem zmiany decyzji, gdy go znamy: dwa równoległe kliknięcia = jeden alert (QA 2026-11-13).
    klucz: `decyzja_${String(row.id).replace(/[/\s:.]/g, '_')}_${nr ?? String(teraz).replace(/[^0-9]/g, '').slice(0, 14)}`,
    typ: 'zmiany',
    tender_id: row.tender_id ?? row.id,
    ton: tak ? 'neutral' : 'ostrzezenie',
    tytul: { pl: `${tak ? 'Szef: startujemy' : 'Szef: nie startujemy'} — ${tytul}`, en: `${tak ? 'Boss: we bid' : 'Boss: we pass'} — ${tytul}` },
    tresc: tak
      ? { pl: `${notatka.pl}Decyzja z linku „do decyzji”. ${coZrobione}`, en: `${notatka.en}Decision from the “for decision” link. The tender is saved with 7/3/1-day reminders and the “Preparing the bid” stage.` }
      : { pl: `${notatka.pl}Decyzja z linku „do decyzji”. Przetarg zostaje na liście — odrzuć go przyciskiem „Nie dla nas”, żeby aplikacja uczyła się z przyczyny.`, en: `${notatka.en}Decision from the “for decision” link. The tender stays on your list — reject it with “Not for us” so the app learns from the reason.` },
    pozycje: [{ tender_id: row.tender_id ?? row.id, tytul: row.tender_title ?? null, organizacja: row.tender_organization ?? null, deadline: row.tender_deadline ?? null, zrodlo: row.tender_source ?? 'bzp' }],
  };
}
