import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';

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
    deadline: firstOf(raw, ['submittingOffersDate', 'offerDeadline', 'tenderSubmissionDeadline', 'deadline']),
    publishedAt: firstOf(raw, ['publicationDate', 'publishDate', 'noticeDate', 'createdDate']),
    url,
    raw: rawLite,
  };
}

function extractList(data) {
  if (Array.isArray(data)) return data;
  return data?.content ?? data?.items ?? data?.notices ?? data?.results ?? data?.data ?? [];
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
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BZP API odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const notices = extractList(data).map(normalizeNotice).filter(Boolean);
  logger.info({ count: notices.length }, 'BZP: pobrano ogłoszenia');
  return notices;
}

// Tryb diagnostyczny: `node src/services/bzp.js --ping`
if (isMainModule(import.meta.url) && process.argv.includes('--ping')) {
  searchNotices({ size: 3 })
    .then((notices) => {
      console.log(`OK — pobrano ${notices.length} ogłoszeń.`);
      if (notices[0]) {
        const { raw, ...summary } = notices[0];
        console.log('Przykład:', JSON.stringify(summary, null, 2));
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('BŁĄD BZP:', err.message);
      process.exit(1);
    });
}
