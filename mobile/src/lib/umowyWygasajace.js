/*
 * Radar wygasających umów (2026-10-31) — czysta prezentacja pozycji z
 * `GET /wygrywalnosc/umowy-wygasajace` (Functions `lib/umowyWygasajace.js`). Bez zegara: dni do
 * końca liczy serwer w chwili odczytu.
 */
import { dzienPL } from './dataUtc.js';

/** Jak pilne: do 45 dni zamawiający zwykle już przygotowuje albo ogłasza przetarg. */
export function tonTerminu(dni) {
  if (!Number.isFinite(dni)) return 'neutralne';
  if (dni <= 45) return 'pilne';
  if (dni <= 120) return 'wkrotce';
  return 'neutralne';
}

/** „kończy się dziś”, „za 20 dni”, „za ok. 4 mies.” — krótko, do odznaki. */
export function opisTerminu(dni, t) {
  if (!Number.isFinite(dni) || dni < 0) return t('termin nieznany', 'unknown end');
  if (dni === 0) return t('kończy się dziś', 'ends today');
  if (dni === 1) return t('za 1 dzień', 'in 1 day');
  if (dni <= 60) return t(`za ${dni} dni`, `in ${dni} days`);
  const mies = Math.round(dni / 30.4);
  return t(`za ok. ${mies} mies.`, `in about ${mies} months`);
}

function dataPL(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Druga linia karty: region · wartość umowy · okres z ogłoszenia · od kiedy. */
export function opisUmowy(u, t, kwota) {
  return [
    u?.region_nazwa ?? null,
    u?.wartosc ? kwota(u.wartosc, t) : null,
    u?.okres ? t(`okres: ${u.okres}`, `term: ${u.okres}`) : null,
    dataPL(u?.data_umowy) ? t(`umowa z ${dataPL(u.data_umowy)}`, `signed ${dataPL(u.data_umowy)}`) : null,
  ].filter(Boolean).join(' · ');
}

export const dataKonca = (u) => dataPL(u?.koniec);

/** Limity jak w Functions: nazwa wyszukiwania ≤ 60 znaków, fraza katalogu ≤ 120. */
const MAKS_NAZWY = 60;
const MAKS_FRAZY = 120;

/**
 * Zapisane wyszukiwanie z alertem na nowe ogłoszenia TEGO zamawiającego (fraza = jego nazwa,
 * katalog dopasowuje wszystkie słowa w tytule i nazwie zamawiającego; region zawęża).
 * Bez nazwy zamawiającego — null.
 */
export function wyszukiwanieZamawiajacego(u) {
  const nazwa = String(u?.zamawiajacy ?? '').replace(/\s+/g, ' ').trim();
  if (!nazwa) return null;
  return {
    nazwa: `Zamawiający: ${nazwa}`.slice(0, MAKS_NAZWY),
    filtry: { q: nazwa.slice(0, MAKS_FRAZY), ...(u.wojewodztwo ? { region: u.wojewodztwo } : {}) },
    alert_wlaczony: true,
  };
}

/** Termin ofert w dniu kalendarzowym w Polsce (północ PL zapisana w UTC to poprzedni dzień). */
function terminPL(iso) {
  const dzien = dzienPL(Date.parse(String(iso ?? '')));
  return dzien === null ? null : dataPL(new Date(dzien).toISOString());
}

/**
 * Następca umowy (2026-11-01): nowy przetarg tego zamawiającego już ogłoszony — „Nowy przetarg już
 * ogłoszony · oferty do 12.11.2026”. Słabsze dopasowanie tytułu (`pewny: false`) to „podobny przetarg”.
 * Bez następcy — null.
 */
export function opisNastepcy(u, t) {
  const n = u?.nastepca;
  if (!n?.tender_id) return null;
  const termin = terminPL(n.deadline);
  return n.pewny === false
    ? t(`Podobny przetarg tego zamawiającego już ogłoszony${termin ? ` · oferty do ${termin}` : ''}`, `A similar tender from this buyer is already published${termin ? ` · bids due ${termin}` : ''}`)
    : t(`Nowy przetarg już ogłoszony${termin ? ` · oferty do ${termin}` : ''}`, `The new tender is already published${termin ? ` · bids due ${termin}` : ''}`);
}

/** Ogłoszenie następcy dla ekranu ogłoszenia (zamawiający ten sam co w umowie — dopasowanie po NIP-ie). */
export function ogloszenieNastepcy(u) {
  const n = u?.nastepca;
  if (!n?.tender_id) return null;
  return {
    id: n.tender_id,
    title: n.tytul ?? null,
    url: n.url ?? null,
    deadline: n.deadline ?? null,
    published_at: n.opublikowano ?? null,
    organization: u.zamawiajacy ?? null,
    source: n.zrodlo ?? null,
  };
}
