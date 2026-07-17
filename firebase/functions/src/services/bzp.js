import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { doUtcIso } from '../lib/daty.js';
import { parsujWadium } from '../lib/wadium.js';

/*
 * Klient publicznego API Biuletynu Zamówień Publicznych (e-Zamówienia).
 *
 * Zweryfikowany endpoint (2026-05): GET {BASE}/notice
 *   Wymagane parametry: NoticeType, PublicationDateFrom, PublicationDateTo,
 *                       PageSize, PageNumber (numeracja od 1).
 *   Odpowiedź: tablica JSON ogłoszeń.
 * Czytanie ogłoszeń krajowych BZP nie wymaga uwierzytelniania.
 * Szczegóły i diagnostyka: runbooks/bzp-api.md.
 */

const BASE = env.BZP_API_BASE_URL.replace(/\/+$/, '');
const SEARCH_PATH = env.BZP_SEARCH_PATH.startsWith('/')
  ? env.BZP_SEARCH_PATH
  : `/${env.BZP_SEARCH_PATH}`;

/*
 * 🚨 PAGINACJA BZP — zmierzone na żywo 2026-07-17 ([[reference_bzp_api_dane]]).
 * Nie zmieniaj tej strategii bez ponownego pomiaru:
 *  • `PageNumber` jest IGNOROWANY — 3 strony × PageSize=100 zwróciły IDENTYCZNE 100
 *    ogłoszeń. Pętla po stronach pobiera w kółko to samo.
 *  • `PageSize` sufit = 500 (1000 → HTTP 400).
 *  • BZP publikuje 400–500 ogłoszeń DZIENNIE — nawet okno 1-dniowe trafia sufit.
 *  • Daty przyjmują godziny, ale sufiks `Z` (UTC) zwraca ZERO wyników.
 *  • Z filtrów działa WYŁĄCZNIE `OrganizationProvince` (PL+TERYT). `OrderType`,
 *    `CpvCode`, `SearchText`, `SortingColumn` są ignorowane (zwracają to samo).
 *
 * Stąd jedyna poprawna strategia: pętla DZIEŃ PO DNIU; gdy dzień trafi sufit —
 * dociąć ten sam dzień po 16 województwach.
 */

/** Sufit `PageSize` w API BZP. Powyżej (1000) API zwraca HTTP 400. */
export const SUFIT_ZAPYTANIA = 500;

/**
 * Kody TERYT województw (NIE NUTS) — jedyny filtr, który BZP honoruje.
 * Służą do docięcia doby, która nie mieści się w sufitie jednego zapytania.
 */
export const WOJEWODZTWA_TERYT = [
  'PL02', 'PL04', 'PL06', 'PL08', 'PL10', 'PL12', 'PL14', 'PL16',
  'PL18', 'PL20', 'PL22', 'PL24', 'PL26', 'PL28', 'PL30', 'PL32',
];

/** Lista dni `YYYY-MM-DD` od `from` do `to` włącznie (czysta logika). */
export function dniWZakresie(from, to) {
  const dni = [];
  const koniec = new Date(`${dateOnly(to)}T00:00:00Z`).getTime();
  let biezacy = new Date(`${dateOnly(from)}T00:00:00Z`).getTime();
  while (biezacy <= koniec) {
    dni.push(new Date(biezacy).toISOString().slice(0, 10));
    biezacy += 86_400_000;
  }
  return dni;
}

function firstOf(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dateOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Normalizuje surowe ogłoszenie BZP do modelu wewnętrznego.
 * Mapowanie jest defensywne (obsługuje warianty nazw pól) — kontrakt API
 * e-Zamówienia bywa zmieniany; patrz runbooks/bzp-api.md.
 */
export function normalizeNotice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const externalId = firstOf(raw, [
    'bzpNumber', 'noticeNumber', 'number', 'noticeId', 'objectId', 'id',
  ]);
  if (!externalId) return null;

  // Surowe dane bez ogromnego pola htmlBody (oszczędność miejsca w bazie).
  // Zanim je odrzucimy, wyciągamy z niego to, co decyduje o starcie — np. wadium.
  const { htmlBody, ...rawLite } = raw;
  const wadium = parsujWadium(htmlBody);

  const tenderId = firstOf(raw, ['tenderId']);
  const url = firstOf(raw, ['htmlUrl', 'url', 'link', 'noticeUrl'])
    ?? (tenderId ? `https://ezamowienia.gov.pl/mp-client/search/list/${tenderId}` : null);

  return {
    externalId: String(externalId),
    title: String(firstOf(raw, ['orderObject', 'title', 'subject', 'name', 'orderName']) ?? 'Bez tytułu'),
    organization: firstOf(raw, ['organizationName', 'orderingEntityName', 'contractingAuthority', 'buyerName', 'institution']),
    cpvMain: firstOf(raw, ['cpvCode', 'mainCpv', 'cpv']),
    budget: toNumber(firstOf(raw, ['estimatedValue', 'orderValue', 'value', 'budget'])),
    currency: firstOf(raw, ['currency']) ?? 'PLN',
    // Normalizacja do UTC przy WEJŚCIU danych: cała baza porównuje daty
    // leksykograficznie, a BZP miesza formaty i strefy (lib/daty.js).
    deadline: doUtcIso(firstOf(raw, ['submittingOffersDate', 'offerDeadline', 'tenderSubmissionDeadline', 'deadline'])),
    publishedAt: doUtcIso(firstOf(raw, ['publicationDate', 'publishDate', 'noticeDate', 'createdDate'])),
    url,
    // Wadium wyciągnięte z htmlBody (D-056). Termin wniesienia = termin składania ofert.
    wadium_wymagane: wadium.wymagane,
    wadium_kwota: wadium.kwota,
    wadium_wiele_czesci: wadium.wieleCzesci ?? false,
    raw: rawLite,
  };
}

function extractList(data) {
  if (Array.isArray(data)) return data;
  return data?.content ?? data?.items ?? data?.notices ?? data?.results ?? data?.data ?? [];
}

/** Kody, przy których ponawianie ma sens: przeciążenie i awarie po stronie BZP. */
const PONAWIALNE = new Set([429, 500, 502, 503, 504]);
const PROBY = 3;
const ODSTEP_BAZOWY_MS = 1500;

/**
 * Pobiera stronę z BZP z ponowieniem i rosnącym odstępem.
 *
 * BZP bywa niedostępne przez chwilę. Bez ponowienia jednorazowa usterka sieci
 * oznaczała, że użytkownicy nie dostają TEGO DNIA żadnych nowych przetargów —
 * cykl uruchamia się raz na dobę (audyt 2026-07-10).
 *
 * Odstępy (1,5 s → 3 s) mieszczą się w budżecie czasu funkcji z zapasem.
 */
async function pobierzZPonowieniem(url) {
  let ostatniBlad = null;

  for (let proba = 1; proba <= PROBY; proba++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' },
        signal: AbortSignal.timeout(25_000),
      });
      // Błąd 4xx (poza 429) to nasza wina — ponawianie niczego nie zmieni.
      if (res.ok || !PONAWIALNE.has(res.status) || proba === PROBY) return res;
      logger.warn({ status: res.status, proba }, 'BZP: odpowiedź do ponowienia');
    } catch (err) {
      ostatniBlad = err;
      if (proba === PROBY) break;
      logger.warn({ err: err.message, proba }, 'BZP: błąd sieci, ponawiam');
    }
    await new Promise((r) => setTimeout(r, ODSTEP_BAZOWY_MS * proba));
  }

  throw ostatniBlad ?? new Error('BZP: pobieranie nie powiodło się po ponowieniach');
}

/**
 * Pobiera ogłoszenia o przetargach z publicznego API BZP.
 * @param {{publishedFrom?: string, publishedTo?: string, page?: number, size?: number}} opts
 *   page — numeracja od 0 (przeliczana na PageNumber API od 1).
 * @returns {Promise<Array>} znormalizowane ogłoszenia
 */
export async function searchNotices({ publishedFrom, publishedTo, page = 0, size = 50, province } = {}) {
  const to = publishedTo ?? dateOnly(Date.now());
  const from = publishedFrom
    ?? dateOnly(Date.now() - env.BZP_LOOKBACK_DAYS * 86_400_000);

  const url = new URL(BASE + SEARCH_PATH);
  url.searchParams.set('NoticeType', env.BZP_NOTICE_TYPE);
  url.searchParams.set('PublicationDateFrom', from);
  url.searchParams.set('PublicationDateTo', to);
  url.searchParams.set('PageSize', String(size));
  url.searchParams.set('PageNumber', String(page + 1)); // API BZP numeruje strony od 1
  // Jedyny filtr, który BZP realnie honoruje — służy do docięcia doby na sufitie.
  if (province) url.searchParams.set('OrganizationProvince', province);

  logger.info({ from, to, page: page + 1, size, province }, 'BZP: pobieranie ogłoszeń');
  const res = await pobierzZPonowieniem(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BZP API odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const surowe = extractList(data);
  const notices = surowe.map(normalizeNotice).filter(Boolean);

  /*
   * Wczesne ostrzeżenie o zmianie schematu BZP. `normalizeNotice` jest wyrozumiały:
   * brak tytułu daje „Bez tytułu", brak identyfikatora — odrzucenie ogłoszenia.
   * Gdyby BZP przemianowało pola, feed po cichu wypełniłby się bezużytecznymi
   * wpisami, a heurystyka przestałaby cokolwiek trafiać. Lepiej krzyknąć w logu.
   */
  const odrzucone = surowe.length - notices.length;
  const bezTytulu = notices.filter((n) => n.title === 'Bez tytułu').length;
  const bezCpv = notices.filter((n) => !n.cpvMain).length;

  if (notices.length && (bezTytulu / notices.length > 0.5 || bezCpv / notices.length > 0.9)) {
    logger.error({ pobrane: notices.length, bezTytulu, bezCpv },
      'BZP: podejrzenie ZMIANY SCHEMATU — większość ogłoszeń bez tytułu lub bez CPV');
  }
  if (odrzucone > 0) {
    logger.warn({ odrzucone, surowe: surowe.length }, 'BZP: ogłoszenia bez identyfikatora pominięte');
  }

  logger.info({ count: notices.length }, 'BZP: pobrano ogłoszenia');
  return notices;
}

/** Okno jednej doby. Bez sufiksu `Z` — UTC zwraca z BZP zero wyników. */
function oknoDoby(dzien) {
  return { publishedFrom: `${dzien}T00:00:00`, publishedTo: `${dzien}T23:59:59` };
}

/**
 * Pobiera jedną dobę. Gdy doba trafi sufit (500 = prawie na pewno są dalsze
 * ogłoszenia, których API nie odda), docina ją po 16 województwach — to jedyny
 * filtr, który BZP honoruje, a `PageNumber` jest ignorowany, więc paginacja odpada.
 */
async function pobierzDzien(dzien) {
  const okno = oknoDoby(dzien);
  const zDnia = await searchNotices({ ...okno, size: SUFIT_ZAPYTANIA });
  if (zDnia.length < SUFIT_ZAPYTANIA) return zDnia;

  logger.warn({ dzien, pobrane: zDnia.length },
    'BZP: doba trafiła sufit zapytania — docinam po województwach, inaczej zgubilibyśmy resztę dnia');

  // Seedujemy PIERWSZĄ stroną (500), zanim dołożymy województwa. Bez tego ogłoszenia
  // BEZ poprawnego kodu TERYT (zagraniczny zamawiający / luka w danych) — których nie
  // zwróci żadne z 16 zapytań `OrganizationProvince` — przepadałyby na dniu z sufitem
  // (audyt 2026-07-17). Dedup po externalId i tak scala nakładki.
  const wynik = new Map(zDnia.map((n) => [n.externalId, n]));
  for (const woj of WOJEWODZTWA_TERYT) {
    try {
      const zWoj = await searchNotices({ ...okno, size: SUFIT_ZAPYTANIA, province: woj });
      for (const n of zWoj) wynik.set(n.externalId, n);
      if (zWoj.length >= SUFIT_ZAPYTANIA) {
        // Pojedyncze województwo na sufitie = nie mamy już czym ciąć (BZP nie ma
        // innego działającego filtra). Krzyczymy — to sygnał do cięcia po godzinach.
        logger.error({ dzien, woj, pobrane: zWoj.length },
          'BZP: województwo też trafiło sufit — część ogłoszeń tej doby jest NIEOSIĄGALNA tym filtrem');
      }
    } catch (err) {
      // Awaria jednego województwa nie może zabrać reszty doby.
      logger.error({ err: err.message, dzien, woj }, 'BZP: województwo pominięte');
    }
  }
  return [...wynik.values()];
}

/**
 * Pobiera ogłoszenia z zakresu dni — DZIEŃ PO DNIU (patrz komentarz o paginacji
 * na górze pliku). Zastępuje jedno zapytanie na całe okno, które przy 400–500
 * ogłoszeniach dziennie gubiło ~85% zakresu `BZP_LOOKBACK_DAYS`.
 *
 * Awaria pojedynczego dnia nie przerywa całości — lepiej oddać 6 dni z 7 niż nic.
 *
 * @param {{from?: string, to?: string}} [opts] domyślnie ostatnie `BZP_LOOKBACK_DAYS` dni
 * @returns {Promise<object[]>} znormalizowane ogłoszenia, zdeduplikowane po `externalId`
 */
export async function pobierzOgloszeniaBzp({ from, to } = {}) {
  const doDnia = to ?? dateOnly(Date.now());
  const odDnia = from ?? dateOnly(Date.now() - env.BZP_LOOKBACK_DAYS * 86_400_000);
  const dni = dniWZakresie(odDnia, doDnia);

  const wszystkie = new Map();
  let bledneDni = 0;
  for (const dzien of dni) {
    try {
      for (const n of await pobierzDzien(dzien)) wszystkie.set(n.externalId, n);
    } catch (err) {
      bledneDni++;
      logger.error({ err: err.message, dzien }, 'BZP: dzień pominięty — reszta okna leci dalej');
    }
  }

  logger.info({ dni: dni.length, bledneDni, ogloszenia: wszystkie.size },
    'BZP: zakończono pobieranie dzień po dniu');
  return [...wszystkie.values()];
}
