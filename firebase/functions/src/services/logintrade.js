import { doUtcIso } from '../lib/daty.js';
import { logger } from '../lib/logger.js';
import { kodWojewodztwa } from '../lib/wojewodztwa.js';

/*
 * LOGINTRADE — szóste źródło ogłoszeń (2026-10-31, z analizy konkurencji: „liczba źródeł”).
 * Zapytania ofertowe spółek (Grupa Azoty, PGE, Lotos, Enea, ZE PAK, Bunge, LOT AMS…) — zakupy poza
 * Pzp, których nie ma w BZP ani na platformazakupowa.pl. Publiczna lista wszystkich kupców
 * `platforma.logintrade.net/platforma-zakupowa,zapytania_otwarte.html?page=N` (HTML, 30 wierszy,
 * od najnowszych): tytuł, data publikacji, DZIEŃ terminu, województwo, status i link do karty
 * zapytania w subdomenie kupca. Karta (bez logowania) dokłada to, czego lista nie ma: kupca z NIP-em
 * i adresem, numer zapytania i termin Z GODZINĄ. Ogłoszenie zapisujemy dopiero po karcie — sam dzień
 * terminu z listy mógłby wprowadzić w błąd (10:00 to nie koniec dnia).
 *
 * Zasady serwisu: robots.txt blokuje tylko `/zalaczniki/` i `/DocumentService` (nie pobieramy
 * plików), regulamin zabrania jedynie działań destabilizujących platformę — stąd odstęp między
 * żądaniami i szczegóły tylko dla NOWYCH zapytań.
 */
export const ZRODLO = 'logintrade';
export const BAZA = 'https://platforma.logintrade.net';
export const USER_AGENT = 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)';
export const LIMIT_ODCZYTU_MS = 30_000;
export const MAKS_DL_OPISU = 2000;

export function adresListy(strona = 1) {
  return `${BAZA}/platforma-zakupowa,zapytania_otwarte.html?page=${Math.max(1, Number(strona) || 1)}`;
}

/** Karta zapytania: tylko https, tylko subdomena kupca w formacie Logintrade (bez IP i hostów lokalnych). */
const WZOR_KARTY = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}\/zapytania_email,(\d+),[0-9a-f]+\.html$/i;
export function bezpiecznyLinkKarty(url) {
  const s = String(url ?? '').trim();
  const m = s.match(WZOR_KARTY);
  if (!m) return null;
  const host = s.split('/')[2].toLowerCase();
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return null;
  return s;
}

const odkoduj = (s) => String(s ?? '')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const bezTagow = (html) => odkoduj(String(html ?? '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, ' ').replace(/<[^>]+>/g, ' '));

/**
 * Wiersze listy. Każdy `<tr>` z linkiem `zapytania_email,<id>,<hash>.html`; komórki: Lp., tytuł,
 * data publikacji, termin (sam dzień), data aktualizacji, województwo, status (`aktywne.png`).
 * @returns {{pozycje: object[], odrzucone: number, aktywnych: number}}
 */
export function parsujListe(html) {
  const wiersze = String(html ?? '').split(/<tr[\s>]/i).slice(1);
  const pozycje = [];
  let odrzucone = 0;
  for (const w of wiersze) {
    const link = w.match(/<a href="([^"]+zapytania_email,(\d+),[0-9a-f]+\.html)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue; // nagłówek tabeli, formularz wyszukiwania
    const url = bezpiecznyLinkKarty(odkoduj(link[1]));
    const tytul = odkoduj(link[3].replace(/<[^>]+>/g, ' '));
    if (!url || !tytul) { odrzucone++; continue; }
    const komorki = [...w.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const tekst = (i) => bezTagow(komorki[i] ?? '');
    const dzien = (s) => (String(s).match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
    pozycje.push({
      id: link[2],
      // Numeracja zapytań jest osobna w każdej instalacji kupca (Grupa Azoty 1670xxx, Bunge 233xxx) — id bez hosta mógłby się powtórzyć.
      host: url.split('/')[2].toLowerCase(),
      tytul,
      url,
      opublikowano: dzien(tekst(2)),
      termin_dzien: dzien(tekst(3)),
      wojewodztwo: tekst(5) || null,
      aktywne: /gfx\/aktywne\.png/i.test(komorki[6] ?? ''),
    });
  }
  return { pozycje, odrzucone, aktywnych: pozycje.filter((p) => p.aktywne).length };
}

const wartoscPola = (html, nazwa) => (String(html).match(new RegExp(`name="${nazwa}"[^>]*value="([^"]*)"`, 'i')) || [null, null])[1];

/**
 * Karta zapytania → kupiec, NIP, numer, termin z godziną (czas polski → UTC), skrót treści.
 * @returns {{zamawiajacy: string|null, nip: string|null, adres: string|null, numer: string|null, termin: string|null, opis: string|null}}
 */
export function parsujSzczegol(html) {
  const s = String(html ?? '');
  const firma = s.match(/<div id="firma_info">([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const zamawiajacy = odkoduj(firma.match(/class="firma_nazwa">([\s\S]*?)<\/h2>/i)?.[1] ?? '') || null;
  const nipM = firma.match(/NIP:\s*([\d\s-]{10,16})/i);
  const nip = nipM ? nipM[1].replace(/\D/g, '') : '';
  const linie = [...firma.matchAll(/<h3>([\s\S]*?)<\/h3>/gi)].map((m) => odkoduj(m[1])).filter((l) => l && !/^(NIP|BDO|REGON|KRS):/i.test(l));
  const numerM = bezTagow(s.match(/ZAPYTANIE OFERTOWE NR([\s\S]{0,200}?)<\/div>/i)?.[1] ?? '');
  const [dz, mi, ro, gg, mm] = ['data_dzien', 'data_miesiac', 'data_rok', 'godz_godz', 'godz_min'].map((n) => wartoscPola(s, n));
  const termin = /^\d{1,2}$/.test(dz ?? '') && /^\d{1,2}$/.test(mi ?? '') && /^\d{4}$/.test(ro ?? '') && /^\d{1,2}$/.test(gg ?? '') && /^\d{1,2}$/.test(mm ?? '')
    ? doUtcIso(`${ro}-${mi.padStart(2, '0')}-${dz.padStart(2, '0')} ${gg.padStart(2, '0')}:${mm.padStart(2, '0')}:00`)
    : null;
  const opisM = s.match(/<div class="niceEdit_text">([\s\S]*?)<\/div>/i);
  const opis = opisM ? bezTagow(opisM[1]).slice(0, MAKS_DL_OPISU) || null : null;
  return {
    zamawiajacy,
    nip: nip.length === 10 ? nip : null,
    adres: linie.length ? linie.join(', ') : null,
    numer: numerM ? numerM.split(' ')[0] || null : null,
    termin,
    opis,
  };
}

/** Identyfikator ogłoszenia: host instalacji kupca + numer zapytania (`lt:pge.logintrade.net:123`). */
export const idLogintrade = (poz) => `lt:${poz.host}:${poz.id}`;

/** Wiersz listy + karta → kształt `tenders.upsert`. Bez karty (kupca i godziny) — null. */
export function normalizujOgloszenieLt(poz, sz) {
  if (!poz?.id || !poz?.host || !poz?.tytul || !sz?.termin || !sz?.zamawiajacy) return null;
  const woj = kodWojewodztwa(poz.wojewodztwo);
  return {
    externalId: idLogintrade(poz),
    title: poz.tytul,
    organization: sz.zamawiajacy,
    zamawiajacy_nip: sz.nip ?? null,
    cpvMain: null,
    budget: null,
    currency: null,
    deadline: sz.termin,
    publishedAt: poz.opublikowano ? doUtcIso(`${poz.opublikowano} 00:00:00`) : null,
    url: poz.url,
    source: ZRODLO,
    numer: sz.numer ?? null,
    wojewodztwo: woj ? `PL${woj}` : null,
    raw: { opis: sz.opis ?? null, adres: sz.adres ?? null },
  };
}

async function pobierzHtml(url, { fetchFn, limitMs }) {
  const kontroler = new AbortController();
  const zegar = setTimeout(() => kontroler.abort(), limitMs);
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: kontroler.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`Logintrade odpowiedział ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(zegar);
  }
}

/** Jedna strona listy. 403/5xx → wyjątek (okno kończy przebieg ze śladem błędu). */
export async function pobierzStrone(strona, { fetchFn = fetch, limitMs = LIMIT_ODCZYTU_MS } = {}) {
  const wynik = parsujListe(await pobierzHtml(adresListy(strona), { fetchFn, limitMs }));
  logger.info({ strona, pozycje: wynik.pozycje.length, aktywnych: wynik.aktywnych }, 'Logintrade: strona listy pobrana');
  return wynik;
}

/** Karta zapytania (link z listy, sprawdzony `bezpiecznyLinkKarty`). */
export async function pobierzSzczegol(url, { fetchFn = fetch, limitMs = LIMIT_ODCZYTU_MS } = {}) {
  const link = bezpiecznyLinkKarty(url);
  if (!link) throw new Error('Logintrade: niedozwolony link karty zapytania');
  return parsujSzczegol(await pobierzHtml(link, { fetchFn, limitMs }));
}
