import { utworzAdapter } from './kontrakt.js';
import { logger } from '../../lib/logger.js';
import { isMainModule } from '../../lib/ids.js';
import { tekst, bezTagow, isoData, parseKwotaPL, absolutnyUrl } from './wspolne.js';

/*
 * Adapter platformazakupowa.pl (Open Nexus) — ulepszenie „Radar zamówień podprogowych
 * — poniżej 170 tys. zł", podzadanie 4/7. Wspólny kontrakt `pobierz(branza, region)
 * -> surowe[]` (./kontrakt.js); mapowanie surowego wpisu → rekord robi dalej
 * lib/normalizacjaPodprogowe.js, a upsert/dedup — db/podprogoweRepo.js.
 *
 * Źródło jest PUBLICZNE i przeszukiwalne bez logowania (spójnie z zakazem płatnego
 * API). Kształt listingu potwierdzony na żywo (2026-07-27, WebFetch
 * https://platformazakupowa.pl/all?query=…): karty postępowań z linkiem
 * `/transakcja/<ID>`, tytułem (bywa z sygnaturą, np. „25/26/P Roboty budowlane…"),
 * kupującym linkującym do strony organizacji `/pn/<slug>` oraz terminem w formacie
 * PL „DD-MM-YYYY HH:MM:SS" (etykieta „Postępowanie trwające:"/„Termin składania
 * ofert"). WARTOŚCI listing NIE podaje — to typowe dla podprogowych; `wartosc_netto`
 * zostaje null (chyba że karta wprost pokazuje „Wartość szacunkowa: … zł"), więc
 * reguła progu w normalizacji odrzuci taki wpis do czasu wzbogacenia o wartość ze
 * szczegółu/regulaminu (podzadanie 5/7). Świadomie NIE zgadujemy kwoty.
 *
 * Parser jest marker-sterowany (kotwice `/transakcja/`, `/pn/`, regex daty) zamiast
 * pełnego DOM — repo nie ma parsera HTML w zależnościach (patrz ./wspolne.js).
 * Bazowy URL czytamy LOKALNIE z process.env (jak w services/bzpWyniki.js), żeby nie
 * mieszać się z niezależnym WIP-em w config/env.js.
 */

const ZRODLO = 'platformazakupowa';
const DOMYSLNY_LIMIT = 30;

const PUBLIC_BASE = (process.env.PLATFORMAZAKUPOWA_BASE_URL
  ?? 'https://platformazakupowa.pl').replace(/\/+$/, '');

const NAGLOWKI = { Accept: 'text/html', 'User-Agent': 'PrzetargAI/0.1' };

// ── Wyłuskiwanie pól z bloku karty (czyste) ──────────────────────────────────

/** Kupujący: kotwica do strony organizacji `/pn/<slug>`, a w razie braku — etykieta. */
function wyodrebnijZamawiajacego(blok) {
  const pn = /<a\b[^>]*\bhref="\/pn\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(blok);
  if (pn) return bezTagow(pn[1]);
  const t = bezTagow(blok) || '';
  const lbl = /(?:kupuj[ąa]cy|zamawiaj[ąa]cy)\s*:?\s*([^|•\n]{2,120}?)(?:\s+post[ęe]powanie|\s+termin|\s+\d{2}[.\-/]\d{2}[.\-/]\d{4}|$)/i.exec(t);
  return lbl ? tekst(lbl[1]) : null;
}

/** Termin: pierwsza data „DD-MM-YYYY [HH:MM[:SS]]" w tekście karty → ISO. */
function wyodrebnijTermin(blok) {
  const t = bezTagow(blok) || '';
  const m = /(\d{2}[.\-/]\d{2}[.\-/]\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/.exec(t);
  return m ? isoData(m[1]) : null;
}

/** Wartość: tylko gdy karta JAWNIE ją pokazuje („Wartość … 150 000,00 zł"); inaczej null. */
function wyodrebnijWartosc(blok) {
  const t = bezTagow(blok) || '';
  const m = /warto[śs][ćc][^0-9]{0,40}?(\d[\d\s.,]*\d|\d)\s*(?:z[łl]|pln)/i.exec(t);
  return m ? parseKwotaPL(m[1]) : null;
}

/**
 * Mapuje pojedynczą kartę postępowania na surowe ogłoszenie (kształt akceptowany
 * przez normalizujPodprogowe). Czysta — testowalna bez sieci.
 * @param {{sciezka: string, id: string, tytul: string|null, blok?: string}} karta
 * @returns {import('./kontrakt.js').SuroweOgloszenie}
 */
export function mapujKarte({ sciezka, id, tytul, blok = '' }) {
  const tytulCzysty = bezTagow(tytul); // defensywnie — działa też na surowym HTML
  return {
    zrodlo: ZRODLO,
    id_zewnetrzny: id !== undefined && id !== null ? String(id) : null,
    tytul: tytulCzysty,
    zamawiajacy: wyodrebnijZamawiajacego(blok),
    wartosc_netto: wyodrebnijWartosc(blok),
    waluta: 'PLN',
    termin_skladania: wyodrebnijTermin(blok),
    link: sciezka ? absolutnyUrl(PUBLIC_BASE, sciezka) : null,
    opis: tytulCzysty, // listing nie daje osobnego opisu przedmiotu
  };
}

/**
 * Parsuje stronę listingu (`/all`) na surowe ogłoszenia. Każde postępowanie to
 * kotwica `/transakcja/<ID>` (tytuł), po której — do następnej takiej kotwicy —
 * leży blok z kupującym i terminem.
 * @param {string} html surowy HTML listingu
 * @returns {import('./kontrakt.js').SuroweOgloszenie[]}
 */
export function wyodrebnijListe(html) {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const surowe = [];
  const KARTA_RE = /<a\b[^>]*\bhref="(\/transakcja\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\b[^>]*\bhref="\/transakcja\/\d+|$)/gi;
  let m;
  while ((m = KARTA_RE.exec(html)) !== null) {
    surowe.push(mapujKarte({ sciezka: m[1], id: m[2], tytul: bezTagow(m[3]), blok: m[4] || '' }));
  }
  return surowe;
}

// ── Transport HTTP (wstrzykiwalny w testach) ─────────────────────────────────

async function pobierzTrescHttp(fraza, { limit = DOMYSLNY_LIMIT } = {}) {
  const url = new URL(`${PUBLIC_BASE}/all`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('query', fraza);
  const res = await fetch(url, { headers: NAGLOWKI, signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`platformazakupowa /all odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 150)}`);
  }
  return res.text();
}

/**
 * Kontraktowe `pobierz(branza, region)`: przeszukuje platformazakupowa.pl frazą
 * branży (a gdy jej brak — regionu) i zwraca surowe ogłoszenia. Region nie jest tu
 * twardym filtrem — dopasowanie branży/regionu robi normalizacja. Pusta branża i
 * region → [] (nie zmyślamy zapytania — spójnie z adapterem BK i services/gus.js).
 * @param {string} [branza]
 * @param {string} [region]
 * @param {{limit?: number, pobierzTresc?: Function}} [opts]
 * @returns {Promise<import('./kontrakt.js').SuroweOgloszenie[]>}
 */
export async function pobierz(branza = '', region = '', opts = {}) {
  const { limit = DOMYSLNY_LIMIT, pobierzTresc = pobierzTrescHttp } = opts;
  const fraza = String(branza || region || '').trim();
  if (!fraza) {
    logger.warn('platformazakupowa adapter: pusta branża i region — pomijam (nie zmyślam zapytania)');
    return [];
  }
  const surowe = wyodrebnijListe(await pobierzTresc(fraza, { limit })).slice(0, limit);
  logger.info({ fraza, pobrano: surowe.length }, 'platformazakupowa adapter: zebrano surowe ogłoszenia');
  return surowe;
}

/** Domyślny adapter platformazakupowa.pl (kontrakt wspólny dla monitora). */
export const adapter = utworzAdapter({ zrodlo: ZRODLO, pobierz });
export default adapter;

// Tryb diagnostyczny: `node src/services/adaptery/platformaZakupowa.js --ping "roboty budowlane"`
if (isMainModule(import.meta.url) && process.argv.includes('--ping')) {
  const fraza = process.argv[process.argv.indexOf('--ping') + 1] || 'roboty budowlane';
  pobierz(fraza, '', { limit: 5 })
    .then((surowe) => {
      console.log(`OK — platformazakupowa: ${surowe.length} surowych ogłoszeń dla „${fraza}".`);
      if (surowe[0]) console.log('Przykład:', JSON.stringify(surowe[0], null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('BŁĄD platformazakupowa adapter:', err.message);
      process.exit(1);
    });
}
