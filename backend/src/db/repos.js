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
const _userDelete = lazy('DELETE FROM users WHERE id = ?');
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

  /**
   * Trwale usuwa konto i dane użytkownika (RODO art. 17).
   *
   * SQLite kaskaduje: `matches`, `feedback` i `magic_links` mają `ON DELETE CASCADE`
   * na `users(id)`, a `PRAGMA foreign_keys = ON` jest ustawiane przy otwarciu
   * połączenia (db/index.js). `audit_logs` i `ai_usage` zostają — inna podstawa
   * prawna (rozliczenia i bezpieczeństwo) i nie niosą treści profilu.
   *
   * Idempotentne: usunięcie nieistniejącego konta nie jest błędem.
   */
  usunKonto(id) {
    _userDelete().run(id);
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
// Pula kandydatów usera (naprawa P-4): każdy przetarg z otwartym terminem, dla
// którego user NIE ma jeszcze dopasowania. Dzienny limit Free dzięki temu odracza
// nadwyżkę na jutro, zamiast ją bezpowrotnie kasować. Brak terminu nie wyklucza.
const _tenderCandidates = lazy(`
  SELECT t.* FROM tenders t
  LEFT JOIN matches m ON m.tender_id = t.id AND m.user_id = ?
  WHERE m.id IS NULL AND (t.deadline IS NULL OR t.deadline > ?)
  ORDER BY t.fetched_at DESC
  LIMIT ?`);

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
  candidatesForUser(userId, limit = 500) {
    return _tenderCandidates().all(userId, nowIso(), limit);
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

// ============================ fitterPremium ============================
// Subskrypcje Premium dla Fitter Welder Pro. Identyfikator urządzenia
// (device_id) zamiast user_id — Fitter MVP nie wymaga konta. Aktualizowane
// przez Stripe webhook (metadata.project === 'fitter').

const _fpUpsert = lazy(`
  INSERT INTO fitter_premium (device_id, plan, status, stripe_customer_id,
                              stripe_subscription_id, current_period_end,
                              created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(device_id) DO UPDATE SET
    plan = excluded.plan,
    status = excluded.status,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    current_period_end = excluded.current_period_end,
    updated_at = excluded.updated_at`);
const _fpByDevice = lazy(`SELECT * FROM fitter_premium WHERE device_id = ?`);
const _fpBySub = lazy(`SELECT * FROM fitter_premium WHERE stripe_subscription_id = ?`);
const _fpUpdateBySubStatus = lazy(`
  UPDATE fitter_premium SET status = ?, current_period_end = ?, updated_at = ?
  WHERE stripe_subscription_id = ?`);

export const fitterPremium = {
  /**
   * Upsert by device_id. Used on checkout.session.completed event when we
   * first learn about a subscription, and again on invoice/subscription
   * updates to refresh the period end.
   */
  upsert({ deviceId, plan, status = 'active', customerId, subscriptionId, currentPeriodEnd }) {
    const ts = nowIso();
    _fpUpsert().run(
      deviceId, plan, status,
      customerId ?? null, subscriptionId ?? null, currentPeriodEnd ?? null,
      ts, ts,
    );
    return _fpByDevice().get(deviceId);
  },
  findByDevice(deviceId) {
    return _fpByDevice().get(deviceId) || null;
  },
  findBySubscription(subscriptionId) {
    return _fpBySub().get(subscriptionId) || null;
  },
  /** Update status + period end based on a webhook event. */
  updateStatusBySubscription(subscriptionId, status, currentPeriodEnd) {
    _fpUpdateBySubStatus().run(status, currentPeriodEnd ?? null, nowIso(), subscriptionId);
  },
};

// ============================ fitter_chat_message ============================

const _chatInsert = lazy(`
  INSERT INTO fitter_chat_message (room, device_id, nickname, text, flags, hidden, created_at)
  VALUES (?, ?, ?, ?, 0, 0, ?)`);
const _chatList = lazy(`
  SELECT id, room, device_id, nickname, text, flags, created_at
  FROM fitter_chat_message
  WHERE room = ? AND hidden = 0 AND (? IS NULL OR created_at > ?)
  ORDER BY created_at ASC
  LIMIT ?`);
const _chatListReverse = lazy(`
  SELECT id, room, device_id, nickname, text, flags, created_at
  FROM fitter_chat_message
  WHERE room = ? AND hidden = 0
  ORDER BY created_at DESC
  LIMIT ?`);
const _chatFlag = lazy(`
  UPDATE fitter_chat_message
  SET flags = flags + 1,
      hidden = CASE WHEN flags + 1 >= 3 THEN 1 ELSE hidden END
  WHERE id = ?`);
const _chatRecentByDevice = lazy(`
  SELECT COUNT(*) as cnt FROM fitter_chat_message
  WHERE device_id = ? AND created_at > ?`);

export const fitterChat = {
  /**
   * Post a message. Returns the inserted row (with id). The caller is
   * expected to have validated text length and applied the profanity filter
   * upstream — the repo just records.
   */
  post({ room, deviceId, nickname, text }) {
    const ts = nowIso();
    const info = _chatInsert().run(room, deviceId, nickname, text, ts);
    return {
      id: info.lastInsertRowid,
      room,
      device_id: deviceId,
      nickname,
      text,
      flags: 0,
      created_at: ts,
    };
  },

  /**
   * Messages in chronological order (oldest first). When [sinceIso] is
   * supplied, returns only messages newer than that timestamp — used by
   * the polling client to fetch deltas.
   */
  list({ room, sinceIso = null, limit = 100 }) {
    return _chatList().all(room, sinceIso, sinceIso, limit);
  },

  /** Most recent N messages (used on first room open). */
  recent({ room, limit = 50 }) {
    const rows = _chatListReverse().all(room, limit);
    return rows.reverse(); // chronological order for the client
  },

  /** Anyone can flag — auto-hide at >=3 reports. */
  report({ id }) {
    _chatFlag().run(id);
  },

  /** Rate-limit helper. Returns count of messages from a device in the
   *  last `windowMinutes`. The route uses this to throttle spammers. */
  recentCountForDevice({ deviceId, windowMinutes = 1 }) {
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    return _chatRecentByDevice().get(deviceId, since).cnt;
  },
};

// ============================ fitter_job_listing ============================

const _jobInsert = lazy(`
  INSERT INTO fitter_job_listing (
    id, device_id, title, company, location, rate, description,
    requirements_csv, contact_email, contact_phone,
    is_paid, stripe_session_id, expires_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`);
const _jobById = lazy(`SELECT * FROM fitter_job_listing WHERE id = ?`);
const _jobBySession = lazy(`SELECT * FROM fitter_job_listing WHERE stripe_session_id = ?`);
const _jobListPaid = lazy(`
  SELECT * FROM fitter_job_listing
  WHERE is_paid = 1
    AND (expires_at IS NULL OR expires_at > ?)
    AND (? IS NULL OR location LIKE ?)
  ORDER BY created_at DESC
  LIMIT ?`);
const _jobListByDevice = lazy(`
  SELECT * FROM fitter_job_listing
  WHERE device_id = ?
  ORDER BY created_at DESC
  LIMIT ?`);
const _jobMarkPaid = lazy(`
  UPDATE fitter_job_listing
  SET is_paid = 1, expires_at = ?, updated_at = ?
  WHERE id = ?`);
const _jobPurgeExpired = lazy(`
  DELETE FROM fitter_job_listing
  WHERE expires_at IS NOT NULL AND expires_at < ?`);

export const fitterJobs = {
  /** Create DRAFT listing (is_paid=0). Returns the inserted row. */
  createDraft({ deviceId, title, company, location, rate, description,
                requirementsCsv, contactEmail, contactPhone, stripeSessionId }) {
    const id = newId();
    const ts = nowIso();
    _jobInsert().run(
      id, deviceId,
      title, company, location, rate ?? null, description,
      requirementsCsv ?? null, contactEmail ?? null, contactPhone ?? null,
      stripeSessionId ?? null, ts, ts,
    );
    return _jobById().get(id);
  },
  findById(id) {
    return _jobById().get(id) || null;
  },
  findBySession(sessionId) {
    return _jobBySession().get(sessionId) || null;
  },
  /** Mark paid + set expiry. Default expiry = 30 days from now. */
  markPaid({ id, expiresAt }) {
    const exp = expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    _jobMarkPaid().run(exp, nowIso(), id);
    return _jobById().get(id);
  },
  /** Paid + non-expired listings for browse view. [locationLike] optional. */
  listPaid({ locationLike = null, limit = 100 } = {}) {
    return _jobListPaid().all(nowIso(), locationLike, locationLike ? `%${locationLike}%` : null, limit);
  },
  listByDevice({ deviceId, limit = 50 }) {
    return _jobListByDevice().all(deviceId, limit);
  },
  /** Housekeeping — drop expired postings. Called periodically (cron). */
  purgeExpired() {
    return _jobPurgeExpired().run(nowIso()).changes;
  },
};

// ============================ stripe_events (idempotencja) ============================

const _seInsert = lazy(
  `INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)
   ON CONFLICT(id) DO NOTHING`,
);
const _seDelete = lazy('DELETE FROM stripe_events WHERE id = ?');

/**
 * Rejestr obsłużonych zdarzeń Stripe. Bez niego powtórna dostawa zdarzenia
 * (Stripe ponawia przy każdym nie-2xx) wystawiała drugą fakturę.
 */
export const stripeEvents = {
  /** true = to PIERWSZA obsługa tego zdarzenia; false = duplikat. */
  claim(eventId, type) {
    return _seInsert().run(eventId, type, nowIso()).changes > 0;
  },
  /** Zwalnia rezerwację po nieudanej obsłudze, żeby Stripe mógł ponowić. */
  release(eventId) {
    _seDelete().run(eventId);
  },
};

// ============================ dobowy limit AI na urządzenie ============================

const _aqdGet = lazy(
  'SELECT calls FROM ai_quota_device WHERE device_id = ? AND day = ? AND operation = ?',
);
const _aqdUpsert = lazy(`
  INSERT INTO ai_quota_device (device_id, day, operation, calls, updated_at)
  VALUES (?, ?, ?, 1, ?)
  ON CONFLICT(device_id, day, operation) DO UPDATE SET calls = calls + 1, updated_at = excluded.updated_at`);

/** Dobowe limity wywołań AI. Premium dostaje tyle, ile potrzeba do pracy. */
const LIMITY_AI_URZADZENIA = {
  fitter_scan: { premium: 60, darmowy: 3 },
  fitter_chat: { premium: 200, darmowy: 15 },
};

/** Statusy subskrypcji Fittera dające dostęp Premium. */
const PREMIUM_AKTYWNY = new Set(['active', 'past_due']);

/**
 * Dobowy limit płatnych wywołań AI na urządzenie.
 *
 * Audyt 2026-07-09/10: trasy `/api/fitter/scan-iso` i `/api/fitter/ai` są
 * nieuwierzytelnione, a każde żądanie kosztuje realne pieniądze (skan ISO to
 * wywołanie Sonneta z wizją). `device_id` to dowolny tekst od klienta. Bramka
 * budżetu chroni przed katastrofą, ale odpala się dopiero po przepaleniu limitu
 * miesięcznego; limiter na adres IP obchodzi się z wielu adresów.
 *
 * Nie odcinamy darmowych użytkowników — to byłaby zmiana produktowa. Sprawiamy
 * tylko, że nadużycie kosztuje atakującego tyle samo pracy, co uczciwe korzystanie.
 */
export const aiQuotaDevice = {
  today() {
    return nowIso().slice(0, 10);
  },

  used(deviceId, operation) {
    return _aqdGet().get(deviceId, this.today(), operation)?.calls ?? 0;
  },

  /** Limit zależny od tego, czy urządzenie ma aktywne Premium. */
  limitDlaUrzadzenia(deviceId, operation) {
    const limity = LIMITY_AI_URZADZENIA[operation] ?? LIMITY_AI_URZADZENIA.fitter_chat;
    const premium = fitterPremium.findByDevice(deviceId);
    return premium && PREMIUM_AKTYWNY.has(premium.status) ? limity.premium : limity.darmowy;
  },

  /** Rezerwuje jedno wywołanie. Zwraca false, gdy dobowy limit wyczerpany. */
  reserve(deviceId, operation, limit = null) {
    const maks = limit ?? this.limitDlaUrzadzenia(deviceId, operation);
    if (this.used(deviceId, operation) >= maks) return false;
    _aqdUpsert().run(deviceId, this.today(), operation, nowIso());
    return true;
  },
};

export const repos = {
  users, tenders, matches, feedback, magicLinks, aiUsage, stripeEvents, aiQuotaDevice,
  fitterPremium, fitterChat, fitterJobs,
};
