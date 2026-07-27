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
const _userSetPassword = lazy(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`);

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
  setPassword(id, passwordHash) {
    _userSetPassword().run(passwordHash, nowIso(), id);
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

// ============================ password_resets ============================
// Token resetu hasła trzymany WYŁĄCZNIE jako hash — repo nigdy nie widzi plaintextu.

const _prInsert = lazy(`
  INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?)`);
const _prByHash = lazy(`SELECT * FROM password_resets WHERE token_hash = ?`);
const _prMarkUsed = lazy(`UPDATE password_resets SET used_at = ? WHERE id = ?`);
const _prDeleteForUser = lazy(`DELETE FROM password_resets WHERE user_id = ?`);

export const passwordResets = {
  create({ userId, tokenHash, expiresAt }) {
    const id = newId();
    _prInsert().run(id, userId, tokenHash, expiresAt, nowIso());
    return id;
  },
  findByHash(tokenHash) {
    return _prByHash().get(tokenHash) ?? null;
  },
  markUsed(id) {
    _prMarkUsed().run(nowIso(), id);
  },
  deleteForUser(userId) {
    _prDeleteForUser().run(userId);
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

// ============================ umowa_monitorowana ============================
// Umowa (kontrakt) wzięta pod monitoring waloryzacji. W chwili podpisania
// zapisujemy branżę kontraktu (po niej dobierany jest wskaźnik cen GUS) oraz
// wskaźnik bazowy GUS (punkt odniesienia — wzrost cen liczymy względem tej bazy).
// Rekord należy do użytkownika; późniejsze podzadania (śledzenie wskaźników,
// alarm, wniosek o waloryzację) czytają go po `user_id`.

const _umInsert = lazy(`
  INSERT INTO umowa_monitorowana (
    id, user_id, branza, wskaznik_bazowy, wskaznik_okres, data_podpisania, prog, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const _umByIdForUser = lazy(`SELECT * FROM umowa_monitorowana WHERE id = ? AND user_id = ?`);
const _umListForUser = lazy(`
  SELECT * FROM umowa_monitorowana WHERE user_id = ? ORDER BY created_at DESC`);
// Rekordy do obsłużenia przez cykliczny job waloryzacji: mają próg z umowy (jest
// co przekraczać) i jeszcze nie wysłały alarmu. Ponad kontami — job pracuje dla
// wszystkich, a powiadamia właściciela rekordu.
const _umDoSprawdzenia = lazy(`
  SELECT * FROM umowa_monitorowana
  WHERE prog IS NOT NULL AND alarm_wyslany = 0
  ORDER BY created_at ASC`);
const _umZapiszWskaznik = lazy(`
  UPDATE umowa_monitorowana
  SET wskaznik_aktualny = ?, wskaznik_aktualny_okres = ?, updated_at = ?
  WHERE id = ?`);
const _umOznaczAlarm = lazy(`
  UPDATE umowa_monitorowana SET alarm_wyslany = 1, updated_at = ? WHERE id = ?`);

export const umowyMonitorowane = {
  /**
   * Bierze umowę pod monitoring. `dataPodpisania` domyślnie = chwila zapisu,
   * `prog` (próg waloryzacji z umowy, %) opcjonalny — bez niego rekord nie alarmuje.
   * Zwraca zapisany wiersz (skopowany do właściciela, więc zawsze istnieje).
   */
  create({ userId, branza, wskaznikBazowy, wskaznikOkres = null, dataPodpisania = null, prog = null }) {
    const id = newId();
    const ts = nowIso();
    _umInsert().run(
      id, userId, branza, wskaznikBazowy, wskaznikOkres ?? null, dataPodpisania ?? ts, prog ?? null, ts, ts,
    );
    return _umByIdForUser().get(id, userId);
  },
  findByIdForUser(id, userId) {
    return _umByIdForUser().get(id, userId) || null;
  },
  listForUser(userId) {
    return _umListForUser().all(userId);
  },
  /** Rekordy do sprawdzenia przez cykliczny job (mają próg, brak wysłanego alarmu). */
  doSprawdzenia() {
    return _umDoSprawdzenia().all();
  },
  /** Zapisuje ostatnio pobrany wskaźnik GUS (obserwacja — także gdy nie ma alarmu). */
  zapiszWskaznik(id, wartosc, okres = null) {
    _umZapiszWskaznik().run(wartosc, okres ?? null, nowIso(), id);
  },
  /** Oznacza, że alarm o przekroczeniu progu został wysłany (dedupe powiadomień). */
  oznaczAlarmWyslany(id) {
    _umOznaczAlarm().run(nowIso(), id);
  },
};

// ============================ Radar SWZ ============================
// Model danych radaru pytań i zmian SWZ (ulepszenie „Radar pytań i odpowiedzi do
// SWZ", podzadanie 1/7). Cztery kolekcje wokół postępowania wziętego pod obserwację
// mechanizmu wyjaśnień treści SWZ (migracja 008). Tu tylko PROSTE zapisy/odczyty —
// bez logiki analizy (kalkulator terminu, analizator, silnik różnic to dalsze
// podzadania). Rekord postępowania należy do użytkownika; kolekcje potomne są
// skopowane po `postepowanie_id`.

// ---------- postepowanie_swz ----------

const _psInsert = lazy(`
  INSERT INTO postepowanie_swz (
    id, user_id, nazwa, data_ogloszenia, termin_skladania_ofert, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const _psByIdForUser = lazy(`SELECT * FROM postepowanie_swz WHERE id = ? AND user_id = ?`);
const _psById = lazy(`SELECT * FROM postepowanie_swz WHERE id = ?`);
const _psListForUser = lazy(`
  SELECT * FROM postepowanie_swz WHERE user_id = ? ORDER BY created_at DESC`);
const _psSetTerminy = lazy(`
  UPDATE postepowanie_swz
  SET data_ogloszenia = ?, termin_skladania_ofert = ?, updated_at = ?
  WHERE id = ?`);
// Postępowania wciąż w oknie monitoringu publikacji zamawiającego: termin składania
// jeszcze nie minął (lub nieznany — obserwujemy dalej). Znany, PRZESZŁY termin
// wypada — po nim zamawiający nie publikuje już zmian SWZ (podzadanie 5/7).
// Porównanie leksykograficzne ISO 8601 (oba znaczniki w UTC z „Z") = porównanie chronologiczne.
const _psDoMonitoringu = lazy(`
  SELECT * FROM postepowanie_swz
  WHERE termin_skladania_ofert IS NULL OR termin_skladania_ofert >= ?
  ORDER BY created_at ASC`);

export const postepowaniaSwz = {
  /**
   * Bierze postępowanie pod radar SWZ. `dataOgloszenia` i `terminSkladaniaOfert`
   * są opcjonalne (mogą dojść później, gdy poznamy dokumentację). Zwraca zapisany
   * wiersz skopowany do właściciela.
   */
  create({ userId, nazwa, dataOgloszenia = null, terminSkladaniaOfert = null }) {
    const id = newId();
    const ts = nowIso();
    _psInsert().run(id, userId, nazwa, dataOgloszenia ?? null, terminSkladaniaOfert ?? null, ts, ts);
    return _psByIdForUser().get(id, userId);
  },
  findByIdForUser(id, userId) {
    return _psByIdForUser().get(id, userId) || null;
  },
  findById(id) {
    return _psById().get(id) || null;
  },
  listForUser(userId) {
    return _psListForUser().all(userId);
  },
  /** Uzupełnia/aktualizuje daty postępowania (ogłoszenie, termin składania). */
  setTerminy(id, { dataOgloszenia = null, terminSkladaniaOfert = null }) {
    _psSetTerminy().run(dataOgloszenia ?? null, terminSkladaniaOfert ?? null, nowIso(), id);
    return _psById().get(id) || null;
  },
  /**
   * Postępowania do cyklicznego monitoringu publikacji na moment `nowIso` (ISO 8601
   * UTC): termin składania ofert jeszcze nie minął albo nie jest znany. Używa go
   * monitor publikacji zamawiającego (jobs/monitorSwz.js) — po terminie składania
   * nie ma już czego dociągać.
   */
  doMonitoringu(nowIso) {
    return _psDoMonitoringu().all(nowIso);
  },
};

// ---------- swz_wersja ----------

const _swInsert = lazy(`
  INSERT INTO swz_wersja (id, postepowanie_id, numer, hash, tresc, sciezka, data_publikacji, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(postepowanie_id, hash) DO NOTHING`);
const _swById = lazy(`SELECT * FROM swz_wersja WHERE id = ?`);
const _swByHash = lazy(`SELECT * FROM swz_wersja WHERE postepowanie_id = ? AND hash = ?`);
const _swList = lazy(`
  SELECT * FROM swz_wersja WHERE postepowanie_id = ? ORDER BY numer ASC, data_publikacji ASC`);
const _swLatest = lazy(`
  SELECT * FROM swz_wersja WHERE postepowanie_id = ? ORDER BY numer DESC LIMIT 1`);
const _swCount = lazy(`SELECT COUNT(*) AS n FROM swz_wersja WHERE postepowanie_id = ?`);

export const swzWersje = {
  /**
   * Dopisuje kolejną wersję SWZ. Dedup po haszu treści: jeśli wersja o tym samym
   * haszu już istnieje w postępowaniu, zwraca ją bez tworzenia duplikatu (monitor
   * publikacji odpala się cyklicznie). `numer` liczony automatycznie, o ile nie
   * podano. Zwraca { wersja, created }.
   */
  add({ postepowanieId, hash, tresc = null, sciezka = null, dataPublikacji = null, numer = null }) {
    const existing = _swByHash().get(postepowanieId, hash);
    if (existing) return { wersja: existing, created: false };
    const id = newId();
    const ts = nowIso();
    const nr = numer ?? _swCount().get(postepowanieId).n + 1;
    const res = _swInsert().run(id, postepowanieId, nr, hash, tresc ?? null, sciezka ?? null, dataPublikacji ?? ts, ts);
    // Wyścig (ten sam hasz w innym wątku wpadł między SELECT a INSERT) → ON CONFLICT
    // DO NOTHING pomija wpis (changes = 0); oddaj wtedy istniejący wiersz.
    if (!res.changes) return { wersja: _swByHash().get(postepowanieId, hash), created: false };
    return { wersja: _swById().get(id), created: true };
  },
  listForPostepowanie(postepowanieId) {
    return _swList().all(postepowanieId);
  },
  latestForPostepowanie(postepowanieId) {
    return _swLatest().get(postepowanieId) || null;
  },
  count(postepowanieId) {
    return _swCount().get(postepowanieId).n;
  },
};

// ---------- pytania_swz ----------

const STATUSY_PYTANIA = new Set(['szkic', 'wyslane', 'odpowiedziane']);

const _pyInsert = lazy(`
  INSERT INTO pytania_swz (id, postepowanie_id, tresc, fragment_swz, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const _pyById = lazy(`SELECT * FROM pytania_swz WHERE id = ?`);
const _pyList = lazy(`
  SELECT * FROM pytania_swz WHERE postepowanie_id = ? ORDER BY created_at ASC`);
const _pySetStatus = lazy(`
  UPDATE pytania_swz SET status = ?, updated_at = ? WHERE id = ?`);

export const pytaniaSwz = {
  /** Zapisuje pytanie do SWZ. Domyślny status 'szkic'. Zwraca zapisany wiersz. */
  create({ postepowanieId, tresc, fragmentSwz = null, status = 'szkic' }) {
    if (!STATUSY_PYTANIA.has(status)) throw new Error(`Nieznany status pytania: ${status}`);
    const id = newId();
    const ts = nowIso();
    _pyInsert().run(id, postepowanieId, tresc, fragmentSwz ?? null, status, ts, ts);
    return _pyById().get(id);
  },
  findById(id) {
    return _pyById().get(id) || null;
  },
  listForPostepowanie(postepowanieId) {
    return _pyList().all(postepowanieId);
  },
  /** Przesuwa pytanie w cyklu życia (szkic → wysłane → odpowiedziane). */
  setStatus(id, status) {
    if (!STATUSY_PYTANIA.has(status)) throw new Error(`Nieznany status pytania: ${status}`);
    _pySetStatus().run(status, nowIso(), id);
    return _pyById().get(id) || null;
  },
};

// ---------- zmiany_swz ----------

function mapZmiana(row) {
  if (!row) return null;
  return {
    ...row,
    elementy_oferty: parseJson(row.elementy_oferty, []),
    // SQLite trzyma 0/1 — oddajemy klientowi/bramce jako boolean.
    uwzglednione: Boolean(row.uwzglednione),
  };
}

const _zmInsert = lazy(`
  INSERT INTO zmiany_swz (
    id, postepowanie_id, wersja_swz_id, data_publikacji, opis_skutku, diff, elementy_oferty, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const _zmById = lazy(`SELECT * FROM zmiany_swz WHERE id = ?`);
const _zmByIdForPostepowanie = lazy(`SELECT * FROM zmiany_swz WHERE id = ? AND postepowanie_id = ?`);
const _zmList = lazy(`
  SELECT * FROM zmiany_swz WHERE postepowanie_id = ? ORDER BY data_publikacji ASC, created_at ASC`);
const _zmSetUwzglednione = lazy(`UPDATE zmiany_swz SET uwzglednione = ? WHERE id = ?`);

export const zmianySwz = {
  /**
   * Zapisuje opublikowaną zmianę/odpowiedź zamawiającego. `elementyOferty` to
   * lista sekcji oferty do aktualizacji (JSON string[]). `wersjaSwzId` opcjonalnie
   * wiąże zmianę z wersją SWZ, z której wynika. Nowa zmiana startuje jako
   * NIEuwzględniona (kolumna `uwzglednione` z DEFAULT 0) — czeka na bramkę.
   * Zwraca zapisany wiersz (z rozpakowaną listą i `uwzglednione` jako boolean).
   */
  create({ postepowanieId, wersjaSwzId = null, dataPublikacji = null, opisSkutku = null, diff = null, elementyOferty = [] }) {
    const id = newId();
    const ts = nowIso();
    _zmInsert().run(
      id, postepowanieId, wersjaSwzId ?? null, dataPublikacji ?? ts,
      opisSkutku ?? null, diff ?? null, JSON.stringify(elementyOferty ?? []), ts,
    );
    return mapZmiana(_zmById().get(id));
  },
  findById(id) {
    return mapZmiana(_zmById().get(id));
  },
  /** Odczyt skopowany do postępowania (bramka weryfikuje przynależność zmiany). */
  findByIdForPostepowanie(id, postepowanieId) {
    return mapZmiana(_zmByIdForPostepowanie().get(id, postepowanieId));
  },
  listForPostepowanie(postepowanieId) {
    return _zmList().all(postepowanieId).map(mapZmiana);
  },
  /** Oznacza zmianę jako uwzględnioną w ofercie (odznaczenie w checkliście) lub cofa to. */
  oznaczUwzglednione(id, wartosc = true) {
    _zmSetUwzglednione().run(wartosc ? 1 : 0, id);
    return mapZmiana(_zmById().get(id));
  },
};

export const repos = {
  users, tenders, matches, feedback, magicLinks, aiUsage, stripeEvents, aiQuotaDevice,
  fitterPremium, fitterChat, fitterJobs, umowyMonitorowane,
  postepowaniaSwz, swzWersje, pytaniaSwz, zmianySwz,
};
