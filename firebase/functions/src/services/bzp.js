import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { doUtcIso } from '../lib/daty.js';

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
  const { htmlBody, ...rawLite } = raw;

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
export async function searchNotices({ publishedFrom, publishedTo, page = 0, size = 50 } = {}) {
  const to = publishedTo ?? dateOnly(Date.now());
  const from = publishedFrom
    ?? dateOnly(Date.now() - env.BZP_LOOKBACK_DAYS * 86_400_000);

  const url = new URL(BASE + SEARCH_PATH);
  url.searchParams.set('NoticeType', env.BZP_NOTICE_TYPE);
  url.searchParams.set('PublicationDateFrom', from);
  url.searchParams.set('PublicationDateTo', to);
  url.searchParams.set('PageSize', String(size));
  url.searchParams.set('PageNumber', String(page + 1)); // API BZP numeruje strony od 1

  logger.info({ from, to, page: page + 1, size }, 'BZP: pobieranie ogłoszeń');
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
