import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { tenders } from '../db/repos.js';
import { pracujDlaWszystkich } from '../services/pracownik.js';

/*
 * Selekcja co 3 h dla planu Standard (także próba) — spec §4.1. Po oknach BZP (:20)
 * i BK (:50) z poprzedniej godziny. Free czeka na przebieg 12:00 w dailyTenderFetch.
 */
export async function runSelekcjaCo3h() {
  if (env.PRACOWNIK_ENABLED !== 'true') return { ok: true, pominiete: 'wylaczone' };
  try {
    tenders.odswiezPule();
    const wynik = await pracujDlaWszystkich({ tylkoStandard: true, tryb: 'co3h' });
    return { ok: true, ...wynik };
  } catch (err) {
    logger.error({ err: err.message }, 'Selekcja co 3 h nie powiodła się');
    return { ok: false, error: err.message };
  }
}
