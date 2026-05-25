import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { searchNotices } from '../services/bzp.js';
import { evaluateMatch } from '../services/matching.js';
import { sendPush } from '../services/push.js';
import { users, tenders, matches } from '../db/repos.js';

/**
 * Generuje dopasowania jednego usera vs lista kandydatów (tenders).
 * Respektuje dzienny limit planu Free i wysyła push dla planu Standard.
 * Eksportowane, by można było wywołać poza cyklem cron — np. backfill
 * po rejestracji nowego usera lub ręcznie z /admin/match-user/:id.
 * @returns {Promise<{created: number, evaluated: number}>}
 */
export async function generateMatchesForUser(user, candidateTenders) {
  if (!user.keywords.length && !user.cpv_codes.length) return { created: 0, evaluated: 0 };

  const isFree = user.premium_tier === 'free';
  let dailyBudget = isFree
    ? Math.max(0, env.FREE_TIER_DAILY_MATCH_LIMIT - matches.countToday(user.id))
    : Infinity;
  if (dailyBudget <= 0) return { created: 0, evaluated: 0 };

  let created = 0;
  let evaluated = 0;
  const fresh = [];

  for (const tender of candidateTenders) {
    if (dailyBudget <= 0) break;
    if (matches.exists(user.id, tender.id)) continue;

    evaluated++;
    const result = await evaluateMatch(user, tender);
    if (result.score < env.MATCH_CONFIDENCE_THRESHOLD) continue;

    const { created: ok, match } = matches.create({
      userId: user.id,
      tenderId: tender.id,
      score: result.score,
      reasoning: result.reasoning,
      scorer: result.scorer,
    });
    if (ok) {
      created++;
      dailyBudget--;
      fresh.push({ id: match.id, title: tender.title });
    }
  }

  // Powiadomienia push — wyłącznie plan Standard.
  if (user.premium_tier === 'standard' && user.push_token && fresh.length) {
    await sendPush(user.push_token, {
      title: 'Nowe dopasowane przetargi',
      body: fresh.length === 1
        ? fresh[0].title
        : `${fresh.length} nowych przetargów dopasowanych do Twojej firmy`,
      data: { type: 'new_matches', count: fresh.length },
    });
    for (const m of fresh) matches.markNotified(m.id);
  }

  return { created, evaluated };
}

/**
 * Generuje dopasowania dla nowo pobranych przetargów × wszystkich userów.
 */
async function generateMatches(newTenders) {
  if (!newTenders.length) return 0;
  let total = 0;
  for (const user of users.all()) {
    const r = await generateMatchesForUser(user, newTenders);
    total += r.created;
  }
  return total;
}

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

  const matchesCreated = await generateMatches(newTenderRecords);
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
