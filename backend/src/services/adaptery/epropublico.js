import { utworzAdapter } from './kontrakt.js';
import { logger } from '../../lib/logger.js';
import { isMainModule } from '../../lib/ids.js';
import { tekst, bezTagow, znorm, isoData, parseKwotaPL, absolutnyUrl, idZUrl } from './wspolne.js';

/*
 * Adapter e-ProPublico (e-propublico.pl, Datacomp) — ulepszenie „Radar zamówień
 * podprogowych — poniżej 170 tys. zł", podzadanie 4/7; wspólny kontrakt
 * `pobierz(branza, region) -> surowe[]` (./kontrakt.js).
 *
 * Platforma publikuje listę ogłoszeń jako TABELĘ HTML. Parser jest NAGŁÓWEK-sterowany:
 * czyta etykiety `<th>` i mapuje je na pola rekordu (przedmiot→tytuł, zamawiający,
 * termin składania, wartość, województwo, data publikacji, numer/sygnatura), a wiersze
 * `<tr>`/`<td>` czyta pozycyjnie względem tych nagłówków. Dzięki temu jest odporny na
 * zmianę KOLEJNOŚCI kolumn; przy braku `<thead>` spada na rozsądną kolejność domyślną.
 * Link do szczegółów bierzemy z pierwszej kotwicy w wierszu. To marker-/nagłówek-
 * sterowane parsowanie zamiast pełnego DOM (repo nie ma parsera HTML — patrz ./wspolne.js).
 *
 * Jak eZamawiający, e-ProPublico bywa dostępne pod różnymi ścieżkami/parametrami
 * listy — dokładny endpoint wyszukiwania potwierdzamy na żywo i podajemy przez env
 * przy wpięciu w monitor (6/7). Bez `EPROPUBLICO_SEARCH_PATH` transport świadomie
 * pomija strumień (nie zgaduje zapytania). Bazowy URL — LOKALNIE z process.env
 * (nie dotykam config/env.js — pułapka drzewa roboczego).
 */

const ZRODLO = 'epropublico';
const DOMYSLNY_LIMIT = 50;

const BASE = (process.env.EPROPUBLICO_BASE_URL ?? 'https://e-propublico.pl').replace(/\/+$/, '');
const SEARCH_PATH = (process.env.EPROPUBLICO_SEARCH_PATH ?? '').trim();

/** Kolejność pól, gdy tabela nie ma nagłówków `<th>` (typowy układ ogłoszeń). */
const DOMYSLNA_KOLEJNOSC = ['id_zewnetrzny', 'tytul', 'zamawiajacy', 'termin_skladania', 'wartosc_netto'];

/** Etykieta nagłówka kolumny → nazwa pola rekordu (albo null, gdy nieznana). */
function polePoNaglowku(label) {
  const t = znorm(label);
  if (!t) return null;
  if (/przedmiot|nazwa|tytul|temat|zamowieni/.test(t) && !/zamawiaj/.test(t)) return 'tytul';
  if (/zamawiaj|jednostk|instytucj|nabywc/.test(t)) return 'zamawiajacy';
  if (/termin|sklad/.test(t)) return 'termin_skladania';
  if (/warto|kwot|szacunk|budzet/.test(t)) return 'wartosc_netto';
  if (/wojewodztw|region|miejsc|lokalizacj/.test(t)) return 'region';
  if (/publik|zamieszcz|ogloszeni|data/.test(t)) return 'data_publikacji';
  if (/numer|sygnatur|znak|nr\b|id/.test(t)) return 'id_zewnetrzny';
  return null;
}

/** Nazwy pól z nagłówków tabeli (pierwszy wiersz z `<th>` / sekcja `<thead>`). */
function wyodrebnijNaglowki(zakres) {
  const thead = /<thead\b[\s\S]*?<\/thead>/i.exec(zakres);
  const src = thead ? thead[0] : zakres;
  const trTh = /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(src);
  const wnetrze = trTh && /<th\b/i.test(trTh[1]) ? trTh[1] : (/<th\b/i.test(src) ? src : '');
  const naglowki = [];
  const TH_RE = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
  let m;
  while ((m = TH_RE.exec(wnetrze)) !== null) naglowki.push(polePoNaglowku(bezTagow(m[1]) || ''));
  return naglowki;
}

/** Komórki wiersza: [{ tekst, link, tekstLinku }]. */
function wyodrebnijKomorki(wnetrze) {
  const komorki = [];
  const TD_RE = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = TD_RE.exec(wnetrze)) !== null) {
    const inner = m[1];
    const a = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
    komorki.push({ tekst: bezTagow(inner), link: a ? a[1] : null, tekstLinku: a ? bezTagow(a[2]) : null });
  }
  return komorki;
}

/**
 * Rozbija tabelę HTML na wiersze danych (bez nagłówka), z rozpoznanymi nagłówkami.
 * @param {string} html surowy HTML listy ogłoszeń
 * @returns {{komorki: Array, naglowki: Array}[]}
 */
export function wyodrebnijWiersze(html) {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const tabela = /<table\b[\s\S]*?<\/table>/i.exec(html);
  const zakres = tabela ? tabela[0] : html;
  const naglowki = wyodrebnijNaglowki(zakres);
  const wiersze = [];
  const TR_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = TR_RE.exec(zakres)) !== null) {
    const wnetrze = m[1];
    if (/<th\b/i.test(wnetrze)) continue; // wiersz nagłówka
    const komorki = wyodrebnijKomorki(wnetrze);
    if (komorki.length) wiersze.push({ komorki, naglowki });
  }
  return wiersze;
}

/**
 * Mapuje jeden wiersz tabeli na surowe ogłoszenie (kształt dla normalizacji).
 * Czysta — testowalna bez sieci.
 * @param {{komorki: Array, naglowki?: Array}} wiersz z `wyodrebnijWiersze`
 * @returns {import('./kontrakt.js').SuroweOgloszenie}
 */
export function mapujWiersz({ komorki = [], naglowki = [] } = {}) {
  const pola = {};
  let link = null;
  komorki.forEach((k, i) => {
    if (k.link && !link) link = k.link; // pierwsza kotwica w wierszu = szczegóły
    const pole = naglowki[i] ?? DOMYSLNA_KOLEJNOSC[i] ?? null;
    if (!pole) return;
    // Dla tytułu wolimy tekst kotwicy (bez śmieci komórki, np. ikon).
    pola[pole] = (pole === 'tytul' && k.tekstLinku) ? k.tekstLinku : k.tekst;
  });

  return {
    zrodlo: ZRODLO,
    id_zewnetrzny: tekst(pola.id_zewnetrzny) ?? idZUrl(link),
    tytul: tekst(pola.tytul),
    zamawiajacy: tekst(pola.zamawiajacy),
    wartosc_netto: parseKwotaPL(pola.wartosc_netto),
    waluta: 'PLN',
    termin_skladania: isoData(pola.termin_skladania),
    data_publikacji: isoData(pola.data_publikacji),
    link: absolutnyUrl(BASE, link),
    region: tekst(pola.region),
    opis: tekst(pola.tytul),
  };
}

/** Skrót: HTML tabeli → surowe ogłoszenia. */
export function wyodrebnijListe(html) {
  return wyodrebnijWiersze(html).map(mapujWiersz);
}

// ── Transport HTTP (wstrzykiwalny w testach) ─────────────────────────────────

async function pobierzTrescHttp(fraza, { limit = DOMYSLNY_LIMIT } = {}) {
  if (!SEARCH_PATH) {
    throw new Error('EPROPUBLICO_SEARCH_PATH nieskonfigurowany — brak endpointu listy ogłoszeń');
  }
  const url = new URL(`${BASE}${SEARCH_PATH.startsWith('/') ? '' : '/'}${SEARCH_PATH}`);
  url.searchParams.set('query', fraza);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url, { headers: { Accept: 'text/html', 'User-Agent': 'PrzetargAI/0.1' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`e-ProPublico lista odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 150)}`);
  }
  return res.text();
}

/**
 * Kontraktowe `pobierz(branza, region)`. Bez `EPROPUBLICO_SEARCH_PATH` (i przy
 * domyślnym transporcie) świadomie zwraca [] — patrz nagłówek modułu.
 * @param {string} [branza]
 * @param {string} [region]
 * @param {{limit?: number, pobierzTresc?: Function}} [opts]
 * @returns {Promise<import('./kontrakt.js').SuroweOgloszenie[]>}
 */
export async function pobierz(branza = '', region = '', opts = {}) {
  const { limit = DOMYSLNY_LIMIT, pobierzTresc = pobierzTrescHttp } = opts;
  const fraza = String(branza || region || '').trim();
  if (!fraza) {
    logger.warn('e-ProPublico adapter: pusta branża i region — pomijam (nie zmyślam zapytania)');
    return [];
  }
  if (!SEARCH_PATH && pobierzTresc === pobierzTrescHttp) {
    logger.warn('e-ProPublico adapter: brak EPROPUBLICO_SEARCH_PATH — pomijam do konfiguracji w 6/7');
    return [];
  }
  const surowe = wyodrebnijListe(await pobierzTresc(fraza, { limit })).slice(0, limit);
  logger.info({ fraza, pobrano: surowe.length }, 'e-ProPublico adapter: zebrano surowe ogłoszenia');
  return surowe;
}

/** Domyślny adapter e-ProPublico (kontrakt wspólny dla monitora). */
export const adapter = utworzAdapter({ zrodlo: ZRODLO, pobierz });
export default adapter;

// Tryb diagnostyczny: `node src/services/adaptery/epropublico.js --ping "usługi"`
if (isMainModule(import.meta.url) && process.argv.includes('--ping')) {
  const fraza = process.argv[process.argv.indexOf('--ping') + 1] || 'usługi';
  pobierz(fraza, '', { limit: 5 })
    .then((surowe) => {
      console.log(`OK — e-ProPublico: ${surowe.length} surowych ogłoszeń dla „${fraza}" (pusto = brak EPROPUBLICO_SEARCH_PATH).`);
      if (surowe[0]) console.log('Przykład:', JSON.stringify(surowe[0], null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('BŁĄD e-ProPublico adapter:', err.message);
      process.exit(1);
    });
}
