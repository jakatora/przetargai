import { env, features } from '../config/env.js';
import { heuristicScore } from '../lib/scoring.js';
import { users, tenders, matches } from '../db/repos.js';
import { scoreTenderMatch } from './ai.js';
import { sendPush } from './push.js';

/** Poniżej tego wyniku heurystycznego nie wołamy AI (kontrola kosztów). */
const AI_PREFILTER_MIN = 15;

function heuristicReasoning(h) {
  const parts = [];
  if (h.matchedKeywords.length) {
    parts.push(`Trafione słowa kluczowe: ${h.matchedKeywords.join(', ')}.`);
  }
  if (h.cpvMatched) parts.push('Zgodność kodu CPV z profilem firmy.');
  return parts.join(' ') || 'Brak wyraźnych trafień w profilu firmy.';
}

/**
 * Ocenia dopasowanie przetargu do firmy.
 * Strategia: heurystyka jako pre-filtr (oszczędność kosztów AI),
 * a dla kandydatów powyżej progu — ocena modelem Claude.
 * @param {{ai?: boolean}} [opts] `ai: false` wymusza samą heurystykę —
 *   używane, gdy budżet wywołań AI na dany przebieg jest już wyczerpany.
 * @returns {Promise<{score: number, reasoning: string, scorer: 'ai'|'heuristic'}>}
 */
export async function evaluateMatch(company, tender, { ai = true } = {}) {
  const heuristic = heuristicScore(company, tender);

  // Pre-filtr — zbyt słabe dopasowanie nie trafia do AI.
  if (ai && heuristic.score >= AI_PREFILTER_MIN && features.ai) {
    const aiResult = await scoreTenderMatch(company, tender);
    if (aiResult) {
      return {
        score: aiResult.score,
        reasoning: aiResult.reasoning || heuristicReasoning(heuristic),
        scorer: 'ai',
      };
    }
  }

  // AI wyłączone / niedostępne / przekroczony budżet / błąd => heurystyka.
  return {
    score: heuristic.score,
    reasoning: heuristicReasoning(heuristic),
    scorer: 'heuristic',
  };
}

/**
 * Generuje dopasowania jednego usera vs pula kandydatów.
 *
 * Kontrola kosztów (spójna z §5 planu migracji): najpierw DARMOWA heurystyka
 * rankuje całą pulę, a płatne AI ocenia wyłącznie czołówkę (AI_RERANK_TOP_N
 * na przebieg). Bez tego kandydat oceniony poniżej progu — który nie zostawia
 * wiersza w `matches` — wracałby do AI przy KAŻDYM przebiegu aż do deadline'u.
 *
 * Respektuje dzienny limit planu Free (odracza, nie kasuje — naprawa P-4)
 * i wysyła push dla planu Standard.
 * @returns {Promise<{created: number, evaluated: number}>}
 */
export async function generateMatchesForUser(user, candidateTenders) {
  if (!user.keywords.length && !user.cpv_codes.length) return { created: 0, evaluated: 0 };

  const isFree = user.premium_tier === 'free';
  let dailyBudget = isFree
    ? Math.max(0, env.FREE_TIER_DAILY_MATCH_LIMIT - matches.countToday(user.id))
    : Infinity;
  if (dailyBudget <= 0) return { created: 0, evaluated: 0 };

  const ranked = candidateTenders
    .map((tender) => ({ tender, heuristic: heuristicScore(user, tender) }))
    .sort((a, b) => b.heuristic.score - a.heuristic.score);

  let aiBudget = env.AI_RERANK_TOP_N;
  let created = 0;
  let evaluated = 0;
  const fresh = [];

  for (const { tender } of ranked) {
    if (dailyBudget <= 0) break;
    if (matches.exists(user.id, tender.id)) continue;

    evaluated++;
    const result = await evaluateMatch(user, tender, { ai: aiBudget > 0 });
    if (result.scorer === 'ai') aiBudget--;
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
 * Dopasowuje usera do ISTNIEJĄCYCH przetargów z otwartym terminem.
 * Wołane z obu miejsc, w których kryteria się pojawiają lub zmieniają:
 * rejestracja oraz PATCH /auth/me (§6.14 planu — bez tego nowe słowo kluczowe
 * działało wyłącznie na ogłoszenia opublikowane po zmianie profilu).
 */
export async function backfillUser(user, { limit = 500 } = {}) {
  const candidates = tenders.candidatesForUser(user.id, limit);
  return generateMatchesForUser(user, candidates);
}

/**
 * Cykl dzienny: pula kandydatów × wszyscy userzy.
 * @returns {Promise<number>} liczba utworzonych dopasowań
 */
export async function generateMatchesForAllUsers() {
  let total = 0;
  for (const user of users.all()) {
    const r = await backfillUser(user);
    total += r.created;
  }
  return total;
}
