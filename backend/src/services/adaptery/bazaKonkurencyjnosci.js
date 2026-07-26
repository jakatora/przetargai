import { utworzAdapter } from './kontrakt.js';
import { logger } from '../../lib/logger.js';
import { isMainModule } from '../../lib/ids.js';

/*
 * Adapter Bazy Konkurencyjności (ulepszenie „Radar zamówień podprogowych — poniżej
 * 170 tys. zł", podzadanie 3/7) — pierwszy konkretny adapter wspólnego kontraktu
 * `pobierz(branza, region) -> surowe[]` (patrz ./kontrakt.js).
 *
 * BK ma PUBLICZNE API JSON (bez scrapingu, bez klucza, bez logowania) — spójnie z
 * zakazem płatnego API. Zweryfikowany kształt (2026-07-27, playwright na żywym
 * portalu bazakonkurencyjnosci.funduszeeuropejskie.gov.pl):
 *
 *   • LISTA:  GET {API}/announcements/search?page=1&limit=N&sort=default
 *                 &query=<fraza>&status[0]=PUBLISHED
 *             -> { status, data: { advertisements: [ { id, title:[..<mark>..],
 *                  content, advertiser_name, publication_date, submission_deadline,
 *                  fulfillment_place } ], meta: { total } } }
 *             Lista NIE zawiera wartości zamówienia ani województwa rozbitego na pola.
 *
 *   • SZCZEGÓŁ: GET {API}/announcements/{id}
 *             -> { status, data: { advertisement: { id, title, publication_date,
 *                  submission_deadline, advertiser_address_details:{ name, address:{
 *                  voivodeship } }, orders:[ { estimated_value:"84000,00"|null,
 *                  order_items:[ { description, cpv_items:[{code,name}],
 *                  fulfillment_places:[{voivodeship,...}], category:{name} } ] } ] } } }
 *             Szacowana wartość jest DOPIERO tutaj (`orders[].estimated_value`,
 *             format PL, bywa null i bywa rozbita na kilka zamówień → sumujemy).
 *
 * Dlatego `pobierz` robi: search (1 zapytanie na frazę) → dla każdego trafienia
 * szczegół (N zapytań) → mapowanie na surowe. To świadome N+1: WYŁĄCZNIE szczegół
 * zna wartość, a bez wartości radar nie oceni progu. Liczbę szczegółów ogranicza
 * `limit`. Gdy szczegół padnie, spadamy na mapowanie z listy (bez wartości → i tak
 * odrzuci to reguła progu w normalizacji; konserwatywnie „nie zgadujemy" kwoty).
 *
 * Bazowe URL-e czytamy LOKALNIE z process.env (jak typy ogłoszeń w services/bzpWyniki.js),
 * żeby to podzadanie nie mieszało się z niezależnym WIP-em w config/env.js.
 */

const ZRODLO = 'baza_konkurencyjnosci';
const DOMYSLNY_LIMIT = 25;

const API_BASE = (process.env.BK_API_BASE_URL
  ?? 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api').replace(/\/+$/, '');
const PUBLIC_BASE = (process.env.BK_PUBLIC_BASE_URL
  ?? 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl').replace(/\/+$/, '');

// ── Helpery mapowania (czyste) ───────────────────────────────────────────────

/** Trim + zwinięcie białych znaków; null dla pustych. */
function tekst(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

/** Zdejmuje tagi HTML (m.in. <mark> z podświetleń wyszukiwarki) i zwija spacje. */
function bezTagow(v) {
  if (v === undefined || v === null) return null;
  const s = Array.isArray(v) ? v.join(' ') : String(v);
  return tekst(s.replace(/<[^>]*>/g, ' '));
}

/** „2026-08-05 12:00:00" → „2026-08-05T12:00:00"; puste/inne → bez zmian/null. */
function isoData(v) {
  const s = tekst(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/.exec(s);
  if (m) return `${m[1]}T${m[2]}`;
  return s; // sama data (YYYY-MM-DD) albo już ISO
}

/** Parsuje kwotę BK w formacie PL („92 228,84" / „92228,84" / liczba) → number|null. */
function parseKwotaPL(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sumuje `estimated_value` po wszystkich zamówieniach (ogłoszenie BK bywa rozbite
 * na kilka `orders`). Zwraca null, gdy żadna wartość nie jest podana (typowe — BK
 * nie musi ujawniać szacunku). Zaokrągla do groszy (float summing).
 */
function sumujWartosc(orders) {
  const lista = Array.isArray(orders) ? orders : [];
  let suma = 0;
  let jest = false;
  for (const o of lista) {
    const v = parseKwotaPL(o?.estimated_value);
    if (v !== null) { suma += v; jest = true; }
  }
  return jest ? Math.round(suma * 100) / 100 : null;
}

/** „Strączno, zachodniopomorskie" → „zachodniopomorskie" (ostatni człon). */
function wojewodztwoZMiejsca(v) {
  const s = tekst(v);
  if (!s) return null;
  const czlony = s.split(',').map((x) => x.trim()).filter(Boolean);
  return czlony.length ? czlony[czlony.length - 1] : s;
}

/** Pierwszy element tablicy lub null. */
function pierwszy(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

// ── Mapowanie odpowiedzi API na surowe ───────────────────────────────────────

/**
 * Wyciąga listę ogłoszeń z odpowiedzi wyszukiwarki (defensywnie — jak w
 * services/bzpWyniki.js). NIE mapuje pól.
 * @param {any} json sparsowana odpowiedź GET /announcements/search
 * @returns {any[]}
 */
export function wyodrebnijListe(json) {
  const d = json?.data ?? json;
  if (Array.isArray(d)) return d;
  const lista = d?.advertisements ?? d?.results ?? d?.items ?? d?.content;
  return Array.isArray(lista) ? lista : [];
}

/**
 * Mapuje SZCZEGÓŁ ogłoszenia BK (GET /announcements/{id}) na surowe ogłoszenie
 * dla normalizacji. Przyjmuje pełną kopertę `{ data: { advertisement } }` albo sam
 * obiekt `advertisement`.
 * @param {any} json
 * @returns {import('./kontrakt.js').SuroweOgloszenie}
 */
export function mapujSzczegol(json) {
  const a = json?.data?.advertisement ?? json?.advertisement ?? json ?? {};
  const orders = Array.isArray(a.orders) ? a.orders : [];
  const item0 = pierwszy(pierwszy(orders)?.order_items) ?? {};
  const miejsce = pierwszy(item0.fulfillment_places) ?? {};
  const addr = a.advertiser_address_details ?? {};
  const cpv = Array.isArray(item0.cpv_items)
    ? item0.cpv_items.map((c) => c?.code).filter(Boolean).join(', ')
    : '';

  return {
    zrodlo: ZRODLO,
    id_zewnetrzny: a.id !== undefined && a.id !== null ? String(a.id) : null,
    tytul: bezTagow(a.title),
    zamawiajacy: tekst(addr.name),
    wartosc_netto: sumujWartosc(orders),
    waluta: 'PLN',
    termin_skladania: isoData(a.submission_deadline),
    data_publikacji: isoData(a.publication_date),
    link: a.id !== undefined && a.id !== null ? `${PUBLIC_BASE}/ogloszenia/${a.id}` : null,
    region: tekst(miejsce.voivodeship) ?? tekst(addr.address?.voivodeship),
    branza: tekst(item0.category?.name) ?? (cpv || null),
    opis: tekst(item0.description),
  };
}

/**
 * Mapuje wpis z LISTY wyszukiwarki na surowe ogłoszenie (fallback, gdy szczegół
 * jest niedostępny). Lista nie zawiera wartości — `wartosc_netto` zostaje null.
 * @param {any} item element data.advertisements[]
 * @returns {import('./kontrakt.js').SuroweOgloszenie}
 */
export function mapujListe(item) {
  const it = item ?? {};
  return {
    zrodlo: ZRODLO,
    id_zewnetrzny: it.id !== undefined && it.id !== null ? String(it.id) : null,
    tytul: bezTagow(it.title),
    zamawiajacy: tekst(it.advertiser_name),
    wartosc_netto: null,
    waluta: 'PLN',
    termin_skladania: isoData(it.submission_deadline),
    data_publikacji: isoData(it.publication_date),
    link: it.id !== undefined && it.id !== null ? `${PUBLIC_BASE}/ogloszenia/${it.id}` : null,
    region: wojewodztwoZMiejsca(it.fulfillment_place),
    opis: bezTagow(it.content),
  };
}

// ── Transport HTTP (wstrzykiwalny w testach) ─────────────────────────────────

const NAGLOWKI = { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' };

async function pobierzListeHttp(fraza, { limit = DOMYSLNY_LIMIT } = {}) {
  const url = new URL(`${API_BASE}/announcements/search`);
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'default');
  url.searchParams.set('query', fraza);
  url.searchParams.set('status[0]', 'PUBLISHED');
  const res = await fetch(url, { headers: NAGLOWKI, signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BK search odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 150)}`);
  }
  return res.json();
}

async function pobierzSzczegolHttp(id) {
  const res = await fetch(`${API_BASE}/announcements/${id}`, {
    headers: NAGLOWKI, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BK szczegół ${id} odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 150)}`);
  }
  return res.json();
}

/**
 * Kontraktowe `pobierz(branza, region)`: pobiera z BK surowe ogłoszenia pasujące
 * do frazy branży (a gdy jej brak — regionu). Region NIE jest tu filtrem twardym —
 * dopasowanie branży/regionu robi normalizacja; tu służy jedynie jako fraza
 * zapytania, gdy branży nie podano. Pusta branża i region → [] (nie zmyślamy
 * zapytania, spójnie z services/gus.js).
 *
 * @param {string} [branza]
 * @param {string} [region]
 * @param {{limit?: number, pobierzListe?: Function, pobierzSzczegol?: Function}} [opts]
 * @returns {Promise<import('./kontrakt.js').SuroweOgloszenie[]>}
 */
export async function pobierz(branza = '', region = '', opts = {}) {
  const {
    limit = DOMYSLNY_LIMIT,
    pobierzListe = pobierzListeHttp,
    pobierzSzczegol = pobierzSzczegolHttp,
  } = opts;

  const fraza = String(branza || region || '').trim();
  if (!fraza) {
    logger.warn('BK adapter: pusta branża i region — pomijam (nie zmyślam zapytania)');
    return [];
  }

  const lista = wyodrebnijListe(await pobierzListe(fraza, { limit })).slice(0, limit);
  const surowe = [];
  for (const item of lista) {
    const id = item?.id;
    if (id === undefined || id === null) continue;
    try {
      surowe.push(mapujSzczegol(await pobierzSzczegol(id)));
    } catch (err) {
      logger.warn({ id, err: err.message }, 'BK adapter: szczegół niedostępny — mapuję z listy (bez wartości)');
      surowe.push(mapujListe(item));
    }
  }
  logger.info({ fraza, pobrano: surowe.length }, 'BK adapter: zebrano surowe ogłoszenia');
  return surowe;
}

/** Domyślny adapter BK (kontrakt wspólny dla monitora). */
export const adapter = utworzAdapter({ zrodlo: ZRODLO, pobierz });
export default adapter;

// Tryb diagnostyczny: `node src/services/adaptery/bazaKonkurencyjnosci.js --ping "roboty budowlane"`
if (isMainModule(import.meta.url) && process.argv.includes('--ping')) {
  const fraza = process.argv[process.argv.indexOf('--ping') + 1] || 'roboty budowlane';
  pobierz(fraza, '', { limit: 3 })
    .then((surowe) => {
      console.log(`OK — pobrano ${surowe.length} surowych ogłoszeń BK dla „${fraza}".`);
      if (surowe[0]) console.log('Przykład:', JSON.stringify(surowe[0], null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('BŁĄD BK adapter:', err.message);
      process.exit(1);
    });
}
