import { doUtcIso } from '../lib/daty.js';
import { logger } from '../lib/logger.js';

/*
 * PLATFORMAZAKUPOWA.PL (Open Nexus) — czwarte źródło ogłoszeń (2026-10-25), zapas na przerwy
 * e-Zamówienia (23–25.10 BZP dawało ~0 nowych ogłoszeń) i uzupełnienie postępowań, które
 * zamawiający prowadzą tylko na platformie. Publiczne listowanie `/all?page=N&limit=100&query=`
 * nie wymaga logowania (HTML z serwera, 100 pozycji na stronę, posortowane po TERMINIE rosnąco,
 * ~4 700 aktywnych); szczegół `/transakcja/<id>` wymaga przejścia cichego SSO z ciasteczkami,
 * więc w tej wersji bierzemy TYLKO listę: tytuł, zamawiający, termin, link. Bez CPV i województwa
 * (null — reguły selekcji „brak danych nie odrzuca”), dopasowanie po słowach z tytułu.
 * Lista miesza zamówienia publiczne z zakupami firm prywatnych — tytuł i zamawiający są
 * widoczne, a klient i tak decyduje po karcie firmy.
 *
 * Uprzejmość wobec serwisu: `robots.txt` ma `Crawl-delay: 900`; okno pobiera 2 strony na
 * godzinę (48 żądań/dobę), kursor stron w checkpoincie — pełne przejście co ~dobę.
 */
export const ZRODLO = 'platformazakupowa';
export const BAZA = 'https://platformazakupowa.pl';
export const POZYCJI_NA_STRONE = 100;
export const USER_AGENT = 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)';
export const LIMIT_ODCZYTU_MS = 30_000;

export function adresListy(strona = 1) {
  return `${BAZA}/all?page=${Math.max(1, Number(strona) || 1)}&limit=${POZYCJI_NA_STRONE}&query=`;
}

export function linkOgloszenia(id) {
  return `${BAZA}/transakcja/${id}`;
}

const odkoduj = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** „DD-MM-YYYY HH:MM:SS" (czas polski, tak pokazuje lista) → ISO UTC albo null. */
export function terminZListy(tekst) {
  const m = String(tekst ?? '').match(/(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return doUtcIso(`${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`);
}

/**
 * Pozycje z HTML listy. Każda to `div.auction-row` z `a.auction-title` (tytuł z sufiksem
 * „(ID <id>)"), nazwą zamawiającego w kolejnej linii i terminem w `b[title="… Europe/Warsaw"]`.
 * Parser jest tolerancyjny: brak id albo tytułu = pozycja odrzucona (liczona w `odrzucone`).
 * @returns {{pozycje: object[], odrzucone: number, stron: number|null}}
 */
export function parsujListe(html) {
  const tekst = String(html ?? '');
  const bloki = tekst.split(/<div class="col-md-12 auction-row/).slice(1);
  const pozycje = [];
  let odrzucone = 0;
  for (const blok of bloki) {
    const tytulM = blok.match(/<a[^>]*href="\/transakcja\/(\d+)"[^>]*class="[^"]*auction-title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (!tytulM) { odrzucone++; continue; }
    const id = tytulM[1];
    const tytul = odkoduj(tytulM[2]).replace(/\s*\(ID \d+\)\s*$/, '').trim();
    if (!tytul) { odrzucone++; continue; }
    const poTytule = blok.slice(blok.indexOf(tytulM[0]) + tytulM[0].length);
    const zamawiajacyM = poTytule.match(/<\/b>\s*<br\s*\/?>\s*([\s\S]*?)<br\s*\/?>/);
    const zamawiajacy = zamawiajacyM ? odkoduj(zamawiajacyM[1]) : '';
    const terminM = blok.match(/title="(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}) Europe\/Warsaw"/);
    pozycje.push({ id, tytul, zamawiajacy, termin: terminM ? terminM[1] : null });
  }
  const strony = [...tekst.matchAll(/[?&]page=(\d+)&/g)].map((m) => Number(m[1]));
  return { pozycje, odrzucone, stron: strony.length ? Math.max(...strony) : null };
}

/** Pozycja listy → kształt `tenders.upsert` (bez CPV, województwa i wartości — lista ich nie ma). */
export function normalizujOgloszeniePz(poz) {
  if (!poz?.id || !poz?.tytul) return null;
  return {
    externalId: `pz:${poz.id}`,
    title: poz.tytul,
    organization: poz.zamawiajacy || null,
    cpvMain: null,
    budget: null,
    currency: null,
    deadline: terminZListy(poz.termin),
    publishedAt: null,
    url: linkOgloszenia(poz.id),
    source: ZRODLO,
    numer: `ID ${poz.id}`,
    wojewodztwo: null,
  };
}

/**
 * Jedna strona listy. 403/5xx → wyjątek z kodem (okno zalicza błąd i próbuje za godzinę).
 * @param {number} strona
 * @param {{fetchFn?: Function, limitMs?: number}} [opcje]
 */
export async function pobierzStrone(strona, { fetchFn = fetch, limitMs = LIMIT_ODCZYTU_MS } = {}) {
  const kontroler = new AbortController();
  const zegar = setTimeout(() => kontroler.abort(), limitMs);
  try {
    const res = await fetchFn(adresListy(strona), { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: kontroler.signal });
    if (!res.ok) throw new Error(`platformazakupowa odpowiedziała ${res.status}`);
    const html = await res.text();
    const wynik = parsujListe(html);
    logger.info({ strona, pozycje: wynik.pozycje.length, odrzucone: wynik.odrzucone }, 'platformazakupowa: strona listy pobrana');
    return wynik;
  } finally {
    clearTimeout(zegar);
  }
}
