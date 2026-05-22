import { db } from './index.js';
import { newId, nowIso, startOfTodayIso } from '../lib/ids.js';

/**
 * Warstwa dostępu do danych. Zapytania przygotowywane leniwie (po migracji),
 * dzięki czemu import tego modułu nie wymaga istnienia tabel.
 */
function lazy(sql) {
  let stmt = null;
  return () => (stmt ||= db.prepare(sql));
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ============================ users ============================

function mapUser(row) {
  if (!row) return null;
  return {
    ...row,
    keywords: parseJson(row.keywords, []),
    cpv_codes: parseJson(row.cpv_codes, []),
  };
}

const _userInsert = lazy(`
  INSERT INTO users (id, company_nip, company_name, email, password_hash,
                     premium_tier, keywords, cpv_codes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'free', ?, ?, ?, ?)`);
const _userById = lazy(`SELECT * FROM users WHERE id = ?`);
const _userByEmail = lazy(`SELECT * FROM users WHERE email = ?`);
const _userByNip = lazy(`SELECT * FROM users WHERE company_nip = ?`);
const _userByStripeCustomer = lazy(`SELECT * FROM users WHERE stripe_customer_id = ?`);
const _userAll = lazy(`SELECT * FROM users`);
const _userUpdateProfile = lazy(`
  UPDATE users SET company_name = ?, keywords = ?, cpv_codes = ?, updated_at = ?
  WHERE id = ?`);
const _userSetPushToken = lazy(`UPDATE users SET push_token = ?, updated_at = ? WHERE id = ?`);
const _userSetTier = lazy(`UPDATE users SET premium_tier = ?, updated_at = ? WHERE id = ?`);
const _userSetStripeCustomer = lazy(`UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?`);
const _userSetStripeSub = lazy(`UPDATE users SET stripe_subscription_id = ?, updated_at = ? WHERE id = ?`);

export const users = {
  create({ companyNip, companyName, email, passwordHash, keywords = [], cpvCodes = [] }) {
    const id = newId();
    const ts = nowIso();
    _userInsert().run(
      id, companyNip, companyName, email, passwordHash,
      JSON.stringify(keywords), JSON.stringify(cpvCodes), ts, ts,
    );
    return mapUser(_userById().get(id));
  },
  findById(id) {
    return mapUser(_userById().get(id));
  },
  findByEmail(email) {
    return mapUser(_userByEmail().get(email));
  },
  findByNip(nip) {
    return mapUser(_userByNip().get(nip));
  },
  findByStripeCustomer(customerId) {
    return mapUser(_userByStripeCustomer().get(customerId));
  },
  all() {
    return _userAll().all().map(mapUser);
  },
  updateProfile(id, { companyName, keywords, cpvCodes }) {
    _userUpdateProfile().run(
      companyName, JSON.stringify(keywords ?? []), JSON.stringify(cpvCodes ?? []),
      nowIso(), id,
    );
    return mapUser(_userById().get(id));
  },
  setPushToken(id, token) {
    _userSetPushToken().run(token ?? null, nowIso(), id);
  },
  setTier(id, tier) {
    _userSetTier().run(tier, nowIso(), id);
  },
  setStripeCustomer(id, customerId) {
    _userSetStripeCustomer().run(customerId ?? null, nowIso(), id);
  },
  setStripeSubscription(id, subscriptionId) {
    _userSetStripeSub().run(subscriptionId ?? null, nowIso(), id);
  },
};

// ============================ tenders ============================

const _tenderByExt = lazy(`SELECT * FROM tenders WHERE bzp_external_id = ?`);
const _tenderById = lazy(`SELECT * FROM tenders WHERE id = ?`);
const _tenderInsert = lazy(`
  INSERT INTO tenders (id, bzp_external_id, title, organization, cpv_main, budget,
                       currency, deadline, url, raw_data, published_at, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(bzp_external_id) DO NOTHING`);
const _tenderRecent = lazy(`SELECT * FROM tenders ORDER BY fetched_at DESC LIMIT ?`);
const _tenderCount = lazy(`SELECT COUNT(*) AS n FROM tenders`);

export const tenders = {
  /** Wstawia przetarg, jeśli jeszcze go nie ma. Zwraca { tender, created }. */
  upsert(t) {
    const existing = _tenderByExt().get(t.externalId);
    if (existing) return { tender: existing, created: false };
    const id = newId();
    _tenderInsert().run(
      id, String(t.externalId), String(t.title), t.organization ?? null,
      t.cpvMain ?? null, t.budget ?? null, t.currency ?? 'PLN', t.deadline ?? null,
      t.url ?? null, JSON.stringify(t.raw ?? {}), t.publishedAt ?? null, nowIso(),
    );
    return { tender: _tenderById().get(id), created: true };
  },
  findById(id) {
    return _tenderById().get(id);
  },
  recent(limit = 200) {
    return _tenderRecent().all(limit);
  },
  count() {
    return _tenderCount().get().n;
  },
};

// ============================ matches ============================

const _matchInsert = lazy(`
  INSERT INTO matches (id, user_id, tender_id, confidence_score, match_reasoning, scorer, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, tender_id) DO NOTHING`);
const _matchById = lazy(`SELECT * FROM matches WHERE id = ? AND user_id = ?`);
const _matchExists = lazy(`SELECT 1 FROM matches WHERE user_id = ? AND tender_id = ?`);
const _matchList = lazy(`
  SELECT m.id, m.user_id, m.tender_id, m.confidence_score, m.match_reasoning,
         m.scorer, m.notified, m.created_at,
         t.title AS tender_title, t.organization AS tender_organization,
         t.budget AS tender_budget, t.currency AS tender_currency,
         t.deadline AS tender_deadline, t.url AS tender_url, t.cpv_main AS tender_cpv
  FROM matches m
  JOIN tenders t ON t.id = m.tender_id
  WHERE m.user_id = ?
  ORDER BY m.created_at DESC, m.confidence_score DESC
  LIMIT ? OFFSET ?`);
const _matchDetail = lazy(`
  SELECT m.*, t.title AS tender_title, t.organization AS tender_organization,
         t.budget AS tender_budget, t.currency AS tender_currency,
         t.deadline AS tender_deadline, t.url AS tender_url, t.cpv_main AS tender_cpv,
         t.raw_data AS tender_raw
  FROM matches m
  JOIN tenders t ON t.id = m.tender_id
  WHERE m.id = ? AND m.user_id = ?`);
const _matchCountToday = lazy(`
  SELECT COUNT(*) AS n FROM matches WHERE user_id = ? AND created_at >= ?`);
const _matchMarkNotified = lazy(`UPDATE matches SET notified = 1 WHERE id = ?`);
const _matchUnnotified = lazy(`
  SELECT m.id, m.confidence_score, t.title AS tender_title
  FROM matches m JOIN tenders t ON t.id = m.tender_id
  WHERE m.user_id = ? AND m.notified = 0`);

export const matches = {
  create({ userId, tenderId, score, reasoning, scorer = 'ai' }) {
    const id = newId();
    const res = _matchInsert().run(
      id, userId, tenderId, Math.round(score), reasoning ?? null, scorer, nowIso(),
    );
    if (!res.changes) return { created: false, match: null };
    return { created: true, match: _matchById().get(id, userId) };
  },
  exists(userId, tenderId) {
    return Boolean(_matchExists().get(userId, tenderId));
  },
  listForUser(userId, { limit = 50, offset = 0 } = {}) {
    return _matchList().all(userId, limit, offset);
  },
  detailForUser(matchId, userId) {
    return _matchDetail().get(matchId, userId);
  },
  countToday(userId) {
    return _matchCountToday().get(userId, startOfTodayIso()).n;
  },
  unnotifiedForUser(userId) {
    return _matchUnnotified().all(userId);
  },
  markNotified(matchId) {
    _matchMarkNotified().run(matchId);
  },
};

// ============================ feedback ============================

const _feedbackUpsert = lazy(`
  INSERT INTO feedback (id, user_id, match_id, helpful, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, match_id)
  DO UPDATE SET helpful = excluded.helpful, created_at = excluded.created_at`);

export const feedback = {
  upsert({ userId, matchId, helpful }) {
    _feedbackUpsert().run(newId(), userId, matchId, helpful ? 1 : 0, nowIso());
  },
};

// ============================ magicLinks ============================

const _mlInsert = lazy(`
  INSERT INTO magic_links (token, user_id, purpose, expires_at, used_at, created_at)
  VALUES (?, ?, ?, ?, NULL, ?)`);
const _mlFind = lazy(`SELECT * FROM magic_links WHERE token = ?`);
const _mlMarkUsed = lazy(`UPDATE magic_links SET used_at = ? WHERE token = ?`);

export const magicLinks = {
  create({ token, userId, purpose, expiresAt }) {
    _mlInsert().run(token, userId, purpose, expiresAt, nowIso());
  },
  find(token) {
    return _mlFind().get(token);
  },
  markUsed(token) {
    _mlMarkUsed().run(nowIso(), token);
  },
};

// ============================ aiUsage ============================

const _aiInsert = lazy(`
  INSERT INTO ai_usage (id, operation, model, input_tokens, output_tokens, cost_usd, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const _aiMonthCost = lazy(`
  SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE created_at >= ?`);
const _aiMonthCalls = lazy(`
  SELECT COUNT(*) AS n FROM ai_usage WHERE created_at >= ?`);

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export const aiUsage = {
  record({ operation, model, inputTokens = 0, outputTokens = 0, costUsd = 0 }) {
    _aiInsert().run(newId(), operation, model, inputTokens, outputTokens, costUsd, nowIso());
  },
  monthCostUsd() {
    return _aiMonthCost().get(monthStartIso()).total;
  },
  monthCallCount() {
    return _aiMonthCalls().get(monthStartIso()).n;
  },
};

export const repos = { users, tenders, matches, feedback, magicLinks, aiUsage };
