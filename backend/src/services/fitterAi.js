import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { costUsd } from '../lib/pricing.js';
import { aiUsage } from '../db/repos.js';
import { aiBudgetAllows } from './ai.js';
import { serviceUnavailable } from '../lib/errors.js';

// Fitter Welder Pro AI chat service. Reuses Anthropic SDK + budget tracking
// from ai.js (same project, same Anthropic key) but runs against a different
// knowledge base and system prompt — answers field welder/fitter questions
// with grounding in piping_knowledge.md (1.2 MB, ~100 iteracji research).
//
// Retrieval: simple keyword/token overlap scoring against pre-split sections.
// Good enough for MVP — embeddings can come later if quality degrades on
// long, ambiguous queries.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.resolve(__dirname, '../data/piping_knowledge.md');

const client = features.ai ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const FITTER_MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = [
  'Jesteś AI asystentem dla monterów i spawaczy rurociągów przemysłowych.',
  'Odpowiadasz krótko, konkretnie, w języku w jakim zadano pytanie (PL/EN).',
  'Korzystasz WYŁĄCZNIE z fragmentów bazy wiedzy podanych w sekcji <baza>...</baza>.',
  'Jeśli baza nie zawiera odpowiedzi, powiedz "Brak w bazie" i zaproponuj sprawdzenie WPS/PQR projektu.',
  'Nie wymyślaj liczb, marek, numerów norm. Cytuj nazwy sekcji w polu citations.',
].join(' ');

// ── Knowledge base loading + retrieval ──────────────────────────────────────

let _kbCache = null;

/** Wczytaj plik bazy raz i podziel na sekcje. */
function loadKnowledgeBase() {
  if (_kbCache) return _kbCache;
  if (!fs.existsSync(KB_PATH)) {
    logger.warn({ path: KB_PATH }, 'piping_knowledge.md missing — fitter AI cannot ground answers');
    _kbCache = [];
    return _kbCache;
  }
  const raw = fs.readFileSync(KB_PATH, 'utf8');
  // Split on top-level "## Iteration N" headings, then further on "### LETTER"
  // sub-sections so chunks stay readable (~2-5 KB each).
  const sections = [];
  // First-level: iterations
  const iterRegex = /^## (Iteration[^\n]*)$/gm;
  let lastIdx = 0;
  let lastTitle = 'preamble';
  let match;
  const all = [];
  while ((match = iterRegex.exec(raw)) !== null) {
    all.push({ start: match.index, title: lastTitle });
    lastTitle = match[1];
    lastIdx = match.index;
  }
  all.push({ start: lastIdx, title: lastTitle });
  for (let i = 0; i < all.length; i++) {
    const start = all[i].start;
    const end = i + 1 < all.length ? all[i + 1].start : raw.length;
    const body = raw.slice(start, end).trim();
    if (body.length < 50) continue;
    // Sub-split on ### LETTER headings to keep chunks small
    const subRegex = /^### (?:[A-Z]{2,}\. )?([^\n]+)$/gm;
    const subs = [];
    let lastSubIdx = 0;
    let lastSubTitle = all[i].title;
    let m2;
    while ((m2 = subRegex.exec(body)) !== null) {
      subs.push({ start: m2.index, title: lastSubTitle });
      lastSubTitle = `${all[i].title} — ${m2[1]}`;
      lastSubIdx = m2.index;
    }
    subs.push({ start: lastSubIdx, title: lastSubTitle });
    for (let j = 0; j < subs.length; j++) {
      const subStart = subs[j].start;
      const subEnd = j + 1 < subs.length ? subs[j + 1].start : body.length;
      const subBody = body.slice(subStart, subEnd).trim();
      if (subBody.length < 50) continue;
      sections.push({ title: subs[j].title, body: subBody });
    }
  }
  logger.info({ count: sections.length }, 'Loaded piping_knowledge.md sections');
  _kbCache = sections;
  return _kbCache;
}

/** Normalise text for matching: lowercase, strip diacritics, alpha-num only. */
function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Top-K sections by keyword token overlap with the query. */
export function retrieveSections(query, k = 4) {
  const kb = loadKnowledgeBase();
  if (kb.length === 0) return [];
  const qTokens = new Set(normalize(query).split(' ').filter(t => t.length >= 3));
  if (qTokens.size === 0) return kb.slice(0, k);
  const scored = kb.map(sec => {
    const titleN = normalize(sec.title);
    const bodyN = normalize(sec.body);
    let score = 0;
    for (const tok of qTokens) {
      if (titleN.includes(tok)) score += 8;
      // Count occurrences in body (capped)
      let count = 0;
      let idx = bodyN.indexOf(tok);
      while (idx >= 0 && count < 5) {
        count++;
        idx = bodyN.indexOf(tok, idx + tok.length);
      }
      score += Math.min(count, 5) * 2;
    }
    return { sec, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter(s => s.score > 0).map(s => s.sec);
}

// ── Public chat API ─────────────────────────────────────────────────────────

/**
 * Zapytanie do Claude z RAG nad piping_knowledge.md.
 *
 * @param {object} params
 * @param {string} params.message - user message
 * @param {Array<{role: 'user'|'assistant', text: string}>} [params.history]
 * @param {string} [params.lang] - 'pl' | 'en'
 * @returns {Promise<{text: string, citations: string[]}>}
 */
export async function chatFitter({ message, history = [], lang = 'pl' }) {
  // Wspólna bramka budżetu (audyt 2026-07-09, CRITICAL). Trasa /api/fitter/ai
  // jest nieuwierzytelniona — bez tego dowolny skrypt pali budżet obu apek.
  if (client && !aiBudgetAllows('fitter_chat')) {
    throw serviceUnavailable('Miesięczny budżet AI wyczerpany — asystent chwilowo niedostępny');
  }
  if (!client) {
    return {
      text: lang === 'en'
        ? 'AI assistant offline (no Anthropic key configured).'
        : 'AI asystent offline (brak klucza Anthropic).',
      citations: [],
    };
  }
  const sections = retrieveSections(message, 4);
  const baseBlock = sections.length === 0
    ? '(brak trafień)'
    : sections.map(s => `[${s.title}]\n${s.body}`).join('\n\n---\n\n');

  const systemMsg = `${SYSTEM_PROMPT}\n\n<baza>\n${baseBlock}\n</baza>`;

  const messages = [
    ...history.slice(-6).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text,
    })),
    { role: 'user', content: message },
  ];

  const t0 = Date.now();
  const resp = await client.messages.create({
    model: FITTER_MODEL,
    max_tokens: 600,
    system: systemMsg,
    messages,
  });
  const elapsedMs = Date.now() - t0;

  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const inputTok = resp.usage?.input_tokens || 0;
  const outputTok = resp.usage?.output_tokens || 0;
  const cost = costUsd(FITTER_MODEL, inputTok, outputTok);
  try {
    aiUsage.record({
      operation: 'fitter_chat',
      model: FITTER_MODEL,
      inputTokens: inputTok,
      outputTokens: outputTok,
      costUsd: cost,
    });
  } catch (e) {
    logger.warn({ err: e.message }, 'aiUsage.record failed');
  }

  logger.info({ ms: elapsedMs, inputTok, outputTok, cost, sections: sections.length },
    'fitter chat answered');

  return {
    text: text || (lang === 'en' ? '(empty response)' : '(pusta odpowiedź)'),
    citations: sections.map(s => s.title),
  };
}
