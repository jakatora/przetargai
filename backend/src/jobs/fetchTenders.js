import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { searchNotices } from '../services/bzp.js';
import { generateMatchesForAllUsers } from '../services/matching.js';
import { tenders } from '../db/repos.js';

/**
 * Pobiera ogłoszenia z BZP, zapisuje nowe przetargi i generuje dopasowania.
 *
 * UWAGA: BZP API `mo-board/api/v1/notice` ma sklejoną paginację — `PageNumber`
 * jest ignorowany i każda strona zwraca te same N najnowszych ogłoszeń.
 * Workaround: jedno zapytanie z dużym `PageSize` (max ~500). Pętla `pages`
 * pozostaje na wypadek poprawki BZP w przyszłości, ale w praktyce zawsze
 * przerwie się po pierwszej iteracji (notices.length < pageSize fail-safe).
 *
 * @param {{pages?: number, pageSize?: number}} opts
 */
export async function runTenderFetch({ pages = 1, pageSize = 500 } = {}) {
  const startedAt = Date.now();
  let fetched = 0;
  const newTenderRecords = [];

  try {
    for (let page = 0; page < pages; page++) {
      const notices = await searchNotices({ page, size: pageSize });
      fetched += notices.length;
      for (const notice of notices) {
        const { tender, created } = tenders.upsert(notice);
        if (created) newTenderRecords.push(tender);
      }
      if (notices.length < pageSize) break; // ostatnia strona wyników
    }
  } catch (err) {
    logger.error({ err: err.message }, 'fetchTenders: pobieranie z BZP nie powiodło się');
    return { ok: false, error: err.message, fetched, newTenders: newTenderRecords.length, matchesCreated: 0 };
  }

  // Dopasowania liczone z PULI kandydatów każdego usera (naprawa P-4), nie tylko
  // z ogłoszeń pobranych w tym cyklu — dlatego biegnie także przy zerze nowych:
  // konto Free odbiera wtedy przetargi odroczone wczoraj przez dzienny limit.
  const matchesCreated = await generateMatchesForAllUsers();
  const durationMs = Date.now() - startedAt;

  logger.info(
    { fetched, newTenders: newTenderRecords.length, matchesCreated, durationMs },
    'fetchTenders: zakończono',
  );
  return { ok: true, fetched, newTenders: newTenderRecords.length, matchesCreated, durationMs };
}

// Ręczne uruchomienie: `npm run fetch-tenders`
if (isMainModule(import.meta.url)) {
  const { migrate } = await import('../db/migrate.js');
  migrate();
  runTenderFetch({ pages: 1 })
    .then((result) => {
      logger.info(result, 'Ręczne uruchomienie fetchTenders zakończone');
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'fetchTenders: błąd krytyczny');
      process.exit(1);
    });
}
