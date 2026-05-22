import { features } from '../config/env.js';
import { heuristicScore } from '../lib/scoring.js';
import { scoreTenderMatch } from './ai.js';

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
 * @returns {Promise<{score: number, reasoning: string, scorer: 'ai'|'heuristic'}>}
 */
export async function evaluateMatch(company, tender) {
  const heuristic = heuristicScore(company, tender);

  // Pre-filtr — zbyt słabe dopasowanie nie trafia do AI.
  if (heuristic.score < AI_PREFILTER_MIN) {
    return {
      score: heuristic.score,
      reasoning: heuristicReasoning(heuristic),
      scorer: 'heuristic',
    };
  }

  if (features.ai) {
    const ai = await scoreTenderMatch(company, tender);
    if (ai) {
      return {
        score: ai.score,
        reasoning: ai.reasoning || heuristicReasoning(heuristic),
        scorer: 'ai',
      };
    }
  }

  // AI niedostępne / przekroczony budżet / błąd => fallback heurystyczny.
  return {
    score: heuristic.score,
    reasoning: heuristicReasoning(heuristic),
    scorer: 'heuristic',
  };
}
