import { logger } from '../lib/logger.js';
import { features } from '../config.js';
import { pobierzOgloszeniaBzp } from '../services/bzp.js';
import { pobierzOgloszeniaTed } from '../services/ted.js';
import { generateMatchesForAllUsers } from '../services/matching.js';
import { tenders, cykl } from '../db/repos.js';

/**
 * Rejestr źródeł ogłoszeń (D-039). Każde źródło zwraca ZNORMALIZOWANE przetargi
 * (kształt `tenders.upsert`); awaria jednego NIE zatrzymuje pozostałych —
 * TED bywa w konserwacji, a BZP musi wtedy dalej spływać (i odwrotnie).
 *
 * 🚨 BZP: `PageNumber` jest IGNOROWANY, sufit `PageSize` = 500, a ogłoszeń jest
 * 400–500 DZIENNIE. Do 2026-07-17 było tu JEDNO zapytanie `PageSize=500` na całe
 * okno `BZP_LOOKBACK_DAYS` (domyślnie 7 dni ≈ 3000+ ogłoszeń) — czyli po cichu
 * gubiliśmy ~85% ogłoszeń, bez błędu w logach. `pobierzOgloszeniaBzp` leci dzień
 * po dniu i docina dobę po województwach, gdy trafi sufit (szczegóły i pomiary:
 * services/bzp.js + [[reference_bzp_api_dane]]). NIE wracać do jednego zapytania.
 * TED: paginacja działa normalnie, sufit stron w adapterze.
 */
function domyslneZrodla() {
  const zrodla = [
    { nazwa: 'bzp', pobierz: () => pobierzOgloszeniaBzp() },
  ];
  if (features.ted) {
    zrodla.push({ nazwa: 'ted', pobierz: () => pobierzOgloszeniaTed() });
  }
  return zrodla;
}

/**
 * Ile ms wolno zużyć na CAŁY przebieg (pobieranie + dopasowania).
 *
 * `dailyTenderFetch` ma twardy limit 540 s — po nim platforma zabija funkcję
 * w połowie pętli. Zostawiamy 60 s zapasu na zapis śladu cyklu i raport.
 */
export const BUDZET_PRZEBIEGU_MS = 480_000;

/**
 * Ile czasu zostało dla cyklu dopasowań po pobraniu ogłoszeń.
 *
 * Po naprawie paginacji BZP pobieranie idzie DZIEŃ PO DNIU i trwa ~134 s zamiast
 * ~21 s (zmierzone na żywym API). Przy stałym budżecie dopasowań 440 s suma
 * wynosiłaby 574 s > 540 s i funkcja ginęła w połowie dopasowań — po cichu,
 * bez błędu. Dlatego budżet dopasowań liczymy z tego, co REALNIE zostało.
 */
export function pozostalyBudzetMs(zuzyteMs, calosc = BUDZET_PRZEBIEGU_MS) {
  return Math.max(0, calosc - zuzyteMs);
}

/**
 * Pobiera ogłoszenia ze wszystkich źródeł, zapisuje nowe i generuje dopasowania.
 * @param {{zrodla?: Array<{nazwa: string, pobierz: () => Promise<object[]>}>}} opts
 *   `zrodla` — wstrzykiwane w testach; produkcja używa rejestru domyślnego.
 *   (`pageSize` usunięty — rozmiar okna nie jest już decyzją wołającego, bo BZP
 *   wymaga cięcia dzień po dniu; patrz komentarz przy `domyslneZrodla`.)
 */
export async function runTenderFetch({ zrodla = domyslneZrodla() } = {}) {
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
    // Budżet z tego, co ZOSTAŁO po pobieraniu — patrz `pozostalyBudzetMs`.
    const budzetCzasuMs = pozostalyBudzetMs(Date.now() - startedAt);
    logger.info({ pobieranieMs: Date.now() - startedAt, budzetDopasowanMs: budzetCzasuMs },
      'fetchTenders: przechodzę do dopasowań z budżetem resztkowym');
    matchesCreated = await generateMatchesForAllUsers({ budzetCzasuMs });
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
