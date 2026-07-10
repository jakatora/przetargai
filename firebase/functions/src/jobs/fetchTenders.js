import { logger } from '../lib/logger.js';
import { features } from '../config.js';
import { searchNotices } from '../services/bzp.js';
import { pobierzOgloszeniaTed } from '../services/ted.js';
import { generateMatchesForAllUsers } from '../services/matching.js';
import { tenders, cykl } from '../db/repos.js';

/**
 * Rejestr źródeł ogłoszeń (D-039). Każde źródło zwraca ZNORMALIZOWANE przetargi
 * (kształt `tenders.upsert`); awaria jednego NIE zatrzymuje pozostałych —
 * TED bywa w konserwacji, a BZP musi wtedy dalej spływać (i odwrotnie).
 *
 * BZP: `PageNumber` w mo-board API jest ignorowany — jedno zapytanie z dużym
 * `PageSize` (max ~500). TED: paginacja działa, sufit stron w adapterze.
 */
function domyslneZrodla(pageSize) {
  const zrodla = [
    { nazwa: 'bzp', pobierz: () => searchNotices({ page: 0, size: pageSize }) },
  ];
  if (features.ted) {
    zrodla.push({ nazwa: 'ted', pobierz: () => pobierzOgloszeniaTed() });
  }
  return zrodla;
}

/**
 * Pobiera ogłoszenia ze wszystkich źródeł, zapisuje nowe i generuje dopasowania.
 * @param {{pageSize?: number, zrodla?: Array<{nazwa: string, pobierz: () => Promise<object[]>}>}} opts
 *   `zrodla` — wstrzykiwane w testach; produkcja używa rejestru domyślnego.
 */
export async function runTenderFetch({ pageSize = 500, zrodla = domyslneZrodla(pageSize) } = {}) {
  const startedAt = Date.now();
  const statystyki = {};
  let fetched = 0;
  let noweTenders = 0;
  let pominiete = 0;

  for (const zrodlo of zrodla) {
    let notices;
    try {
      notices = await zrodlo.pobierz();
    } catch (err) {
      logger.error({ err: err.message, zrodlo: zrodlo.nazwa },
        'fetchTenders: pobieranie ze źródła nie powiodło się');
      statystyki[zrodlo.nazwa] = { fetched: 0, newTenders: 0, error: err.message };
      continue;
    }

    /*
     * Zapis ogłoszenie po ogłoszeniu, każde w osobnym try. Audyt 2026-07-10:
     * pojedyncze ogłoszenie potrafi przekroczyć limit 1 MiB na dokument Firestore
     * (`raw_data` z `htmlBody` bywa ogromne) — bez izolacji jeden taki rekord
     * przerywał zapis CAŁEJ partii i pozostałe 499 przetargów nie trafiało do bazy.
     */
    let nowe = 0;
    for (const notice of notices) {
      try {
        const { created } = await tenders.upsert(notice);
        if (created) nowe++;
      } catch (err) {
        pominiete++;
        logger.error({ err: err.message, externalId: notice?.externalId, zrodlo: zrodlo.nazwa },
          'fetchTenders: pominięto ogłoszenie, którego nie dało się zapisać');
      }
    }

    statystyki[zrodlo.nazwa] = { fetched: notices.length, newTenders: nowe };
    fetched += notices.length;
    noweTenders += nowe;
  }

  // Cykl ma sens, jeśli COKOLWIEK się pobrało; ok:false = padły wszystkie źródła.
  const wszystkiePadly = zrodla.length > 0
    && Object.values(statystyki).every((s) => s.error);
  if (wszystkiePadly) {
    const bledy = Object.entries(statystyki).map(([n, s]) => `${n}: ${s.error}`).join('; ');
    return { ok: false, error: bledy, fetched: 0, newTenders: 0, matchesCreated: 0, zrodla: statystyki };
  }

  // Nowe ogłoszenia są w bazie — cache puli w tej instancji jest już nieaktualny.
  tenders.odswiezPule();

  // Dopasowania liczymy nawet po częściowym zapisie — konto Free odbiera wtedy
  // przetargi odroczone wczoraj przez dzienny limit.
  let matchesCreated = 0;
  try {
    matchesCreated = await generateMatchesForAllUsers();
  } catch (err) {
    logger.error({ err: err.message }, 'fetchTenders: cykl dopasowań nie powiódł się');
    return {
      ok: false, error: err.message, fetched, newTenders: noweTenders,
      skipped: pominiete, matchesCreated: 0, zrodla: statystyki,
    };
  }

  const durationMs = Date.now() - startedAt;
  const wynik = {
    ok: true, fetched, newTenders: noweTenders, skipped: pominiete,
    matchesCreated, durationMs, zrodla: statystyki,
  };

  // Ślad dla /health — inaczej „martwy cron" jest niewykrywalny z zewnątrz.
  await cykl.zapiszPrzebieg(wynik).catch((err) =>
    logger.error({ err: err.message }, 'Nie udało się zapisać śladu cyklu'));

  logger.info(wynik, 'fetchTenders: zakończono');
  return wynik;
}
