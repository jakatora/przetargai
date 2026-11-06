import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { newId, nowIso } from '../lib/ids.js';
import { badRequest, notFound, tooMany, unauthorized } from '../lib/errors.js';
import { buildContext, decide, splitKey, visible } from './spoinaRules.js';

/**
 * Spoina — magazyn dokumentów firm, sesje urządzeń i kody logowania.
 *
 * Każda firma ma licznik `rev`. Zapis podbija go o jeden i stempluje nim zmienione dokumenty,
 * więc urządzenie pyta „co się zmieniło po rev = N" i dostaje tylko różnicę. Dokumenty firmy
 * trzymamy sparsowane w pamięci (jedna firma to kilkaset małych obiektów) — odczyt i sprawdzanie
 * uprawnień nie czytają bazy przy każdym odpytaniu; baza jest źródłem prawdy, pamięć jej kopią
 * unieważnianą po `rev`.
 */

const MAX_DOC_BYTES = 100_000;
const MAX_CHANGES = 500;
const MAX_DOCS_PER_COMPANY = 200_000;
const MAX_CACHED_COMPANIES = 50;

const CODE_TTL_MS = 10 * 60_000;
const CODE_MIN_INTERVAL_MS = 30_000;
const CODE_WINDOW_MS = 60 * 60_000;
const CODE_MAX_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;
const SESSION_TTL_MS = 180 * 24 * 60 * 60_000;
const SEEN_EVERY_MS = 60 * 60_000;

/** Powiadamia odpytujące urządzenia, że w firmie coś się zmieniło. */
export const zmiany = new EventEmitter();
zmiany.setMaxListeners(0);

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (s) => crypto.createHmac('sha256', env.JWT_SECRET).update(`spoina:${s}`, 'utf8').digest('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Numer telefonu jako same cyfry z kierunkowym; 9 cyfr = numer polski. Pusty napis = niepoprawny. */
export function canonPhone(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = `48${d}`;
  return d.length >= 10 && d.length <= 15 ? d : '';
}

// ── Stan firmy w pamięci ─────────────────────────────────────────────────────

class CompanyState {
  constructor(rev) {
    this.rev = rev;
    /** @type {Map<string, {obj:any, json:string, rev:number}>} */
    this.docs = new Map();
    /** @type {Map<string, number>} usunięte dokumenty → rev usunięcia */
    this.gone = new Map();
    this.byCol = new Map();
  }

  get(key) { return this.docs.get(key)?.obj; }

  /** Pary [id, dokument] jednej kolekcji. */
  list(col) {
    let cached = this.byCol.get(col);
    if (!cached) {
      cached = [];
      const prefix = `${col}/`;
      for (const [key, d] of this.docs) if (key.startsWith(prefix)) cached.push([key.slice(prefix.length), d.obj]);
      this.byCol.set(col, cached);
    }
    return cached;
  }

  set(key, obj, json, rev) {
    this.byCol.delete(key.slice(0, key.indexOf('/')));
    if (obj === null) {
      this.docs.delete(key);
      this.gone.set(key, rev);
    } else {
      this.docs.set(key, { obj, json, rev });
      this.gone.delete(key);
    }
  }
}

/** @type {Map<string, CompanyState>} */
const cache = new Map();

function companyRow(companyId) {
  return db.prepare('SELECT id, name, rev, fixed_code_hash FROM spoina_companies WHERE id = ?').get(companyId);
}

function loadState(companyId) {
  const row = companyRow(companyId);
  if (!row) throw notFound('Nie ma takiej firmy');
  const hit = cache.get(companyId);
  if (hit && hit.rev === row.rev) {
    cache.delete(companyId); // odświeża kolejność — najdawniej używane firmy wypadają pierwsze
    cache.set(companyId, hit);
    return hit;
  }
  const state = new CompanyState(row.rev);
  for (const r of db.prepare('SELECT key, json, rev FROM spoina_docs WHERE company_id = ?').all(companyId)) {
    if (r.json === null) state.gone.set(r.key, r.rev);
    else state.docs.set(r.key, { obj: JSON.parse(r.json), json: r.json, rev: r.rev });
  }
  cache.set(companyId, state);
  while (cache.size > MAX_CACHED_COMPANIES) cache.delete(cache.keys().next().value);
  return state;
}

/** JSON dokumentu w postaci widocznej dla osoby; `null`, gdy go nie widzi albo nie istnieje. */
function visibleJson(ctx, state, key) {
  const d = state.docs.get(key);
  if (!d) return null;
  const v = visible(ctx, key, d.obj);
  if (v === undefined) return null;
  return v === d.obj ? d.json : JSON.stringify(v);
}

// ── Odczyt ───────────────────────────────────────────────────────────────────

/** Numer ostatniej zmiany w firmie. */
export function companyRev(companyId) {
  return companyRow(companyId)?.rev ?? 0;
}

/**
 * Dokumenty dla urządzenia.
 * Biuro i narzędziownia dostają różnicę po `since` (to, co widzą, zależy tylko od samego
 * dokumentu). Pracownik i brygadzista dostają cały swój widok: zmiana przydziału potrafi
 * odsłonić albo zasłonić budowę, której dokument sam się nie zmienił.
 * @returns {{rev:number, full:boolean, docs:Record<string,string|null>}}
 */
export function pull(member, since) {
  const state = loadState(member.companyId);
  const ctx = buildContext(state, member);
  const docs = {};
  const incremental = !ctx.field && Number.isInteger(since) && since > 0 && since <= state.rev;
  if (incremental) {
    for (const [key, d] of state.docs) if (d.rev > since) docs[key] = visibleJson(ctx, state, key);
    for (const [key, rev] of state.gone) if (rev > since) docs[key] = null;
    return { rev: state.rev, full: false, docs };
  }
  if (Number.isInteger(since) && since === state.rev) return { rev: state.rev, full: false, docs };
  for (const key of state.docs.keys()) {
    const json = visibleJson(ctx, state, key);
    if (json !== null) docs[key] = json;
  }
  return { rev: state.rev, full: true, docs };
}

// ── Zapis ────────────────────────────────────────────────────────────────────

function syncMember(companyId, workerId, worker) {
  if (worker === null) {
    db.prepare('DELETE FROM spoina_members WHERE company_id = ? AND worker_id = ?').run(companyId, workerId);
    db.prepare('DELETE FROM spoina_sessions WHERE company_id = ? AND worker_id = ?').run(companyId, workerId);
    return;
  }
  db.prepare(`
    INSERT INTO spoina_members (company_id, worker_id, phone, role, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_id, worker_id) DO UPDATE SET phone = excluded.phone, role = excluded.role, updated_at = excluded.updated_at
  `).run(companyId, workerId, canonPhone(worker.phone), worker.role, nowIso());
}

/**
 * Zapisuje zmiany jednej osoby. Każda zmiana przechodzi przez reguły ról; odrzucone nie
 * przerywają pozostałych. Zwraca aktualną (widoczną dla tej osoby) postać KAŻDEGO dokumentu
 * z żądania — aplikacja nakłada ją u siebie, więc odrzucona zmiana sama się cofa.
 * @param {{companyId:string, workerId:string, role:string}} member
 * @param {Record<string, null|{v:any}|{p:object}>} changes
 * @param {{trusted?:boolean}} [opts] trusted = zmiana serwera (zakładanie firmy), bez reguł ról
 */
export function applyChanges(member, changes, opts = {}) {
  const keys = Object.keys(changes ?? {});
  if (keys.length === 0) return { rev: companyRev(member.companyId), docs: {}, rejected: [] };
  if (keys.length > MAX_CHANGES) throw badRequest(`Za dużo zmian w jednym żądaniu (limit ${MAX_CHANGES})`);

  const rejected = [];
  let state;
  let wrote = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    state = loadState(member.companyId);
    const ctx = opts.trusted ? { ...buildContext(state, member), office: true } : buildContext(state, member);
    const rev = state.rev + 1;
    const upsert = db.prepare(`
      INSERT INTO spoina_docs (company_id, key, json, rev, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id, key) DO UPDATE SET json = excluded.json, rev = excluded.rev,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `);
    const now = nowIso();

    for (const key of keys) {
      const parts = splitKey(key);
      if (!parts) { rejected.push({ key, reason: 'niepoprawny klucz' }); continue; }
      const cur = state.get(key);
      const d = decide(ctx, key, cur, changes[key]);
      if (d.reject) { rejected.push({ key, reason: d.reject }); continue; }
      const next = d.next;
      if (next === null) {
        if (cur === undefined) continue;
        upsert.run(member.companyId, key, null, rev, member.workerId, now);
        state.set(key, null, null, rev);
      } else {
        const json = JSON.stringify(next);
        if (cur !== undefined && state.docs.get(key).json === json) continue;
        if (json.length > MAX_DOC_BYTES) { rejected.push({ key, reason: 'dokument jest za duży' }); continue; }
        if (cur === undefined && state.docs.size >= MAX_DOCS_PER_COMPANY) {
          rejected.push({ key, reason: 'firma osiągnęła limit liczby dokumentów' }); continue;
        }
        upsert.run(member.companyId, key, json, rev, member.workerId, now);
        state.set(key, next, json, rev);
      }
      if (parts.col === 'workers') syncMember(member.companyId, parts.id, next);
      wrote = true;
    }
    if (wrote) {
      db.prepare('UPDATE spoina_companies SET rev = ? WHERE id = ?').run(rev, member.companyId);
      state.rev = rev;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    cache.delete(member.companyId); // pamięć mogła wyprzedzić bazę — wczytamy ją od nowa
    throw err;
  }

  // Rola i ekipa mogły się zmienić w tym samym żądaniu — widok liczymy na nowo.
  const fresh = memberOf(member.companyId, member.workerId) ?? member;
  const ctx = buildContext(state, fresh);
  const docs = {};
  for (const key of keys) if (splitKey(key)) docs[key] = visibleJson(ctx, state, key);
  if (wrote) zmiany.emit(member.companyId);
  return { rev: state.rev, docs, rejected };
}

// ── Firmy (administracja) ────────────────────────────────────────────────────

/** Zakłada firmę z pierwszą osobą w biurze. Zwraca identyfikatory do logowania. */
export function createCompany({ name, ownerName, ownerPhone, ownerId, fixedCode }) {
  const phone = canonPhone(ownerPhone);
  if (!phone) throw badRequest('Niepoprawny numer telefonu właściciela');
  const companyId = newId();
  const workerId = ownerId ?? `p${crypto.randomBytes(4).toString('hex')}`;
  db.prepare('INSERT INTO spoina_companies (id, name, rev, fixed_code_hash, created_at) VALUES (?, ?, 0, ?, ?)')
    .run(companyId, name, fixedCode ? hmac(`${companyId}:${fixedCode}`) : null, nowIso());
  try {
    const { rejected } = applyChanges({ companyId, workerId, role: 'office' }, {
      [`workers/${workerId}`]: { v: { id: workerId, name: ownerName, phone: ownerPhone, job: 'Biuro', role: 'office', invited: true } },
      'meta/settings': { v: { companyName: name } },
    }, { trusted: true });
    if (rejected.length) throw badRequest('Nie udało się założyć firmy', rejected);
  } catch (err) {
    // Firma bez osoby w biurze byłaby martwa — nikt nie mógłby się do niej zalogować.
    db.prepare('DELETE FROM spoina_companies WHERE id = ?').run(companyId);
    cache.delete(companyId);
    throw err;
  }
  return { companyId, workerId };
}

export function listCompanies() {
  return db.prepare(`
    SELECT c.id, c.name, c.rev, c.created_at, c.fixed_code_hash IS NOT NULL AS fixed_code,
      (SELECT COUNT(*) FROM spoina_members m WHERE m.company_id = c.id) AS members,
      (SELECT COUNT(*) FROM spoina_docs d WHERE d.company_id = c.id AND d.json IS NOT NULL) AS docs
    FROM spoina_companies c ORDER BY c.created_at
  `).all().map((r) => ({ ...r, fixed_code: Boolean(r.fixed_code) }));
}

/** Zmienia nazwę albo stały kod logowania firmy (`fixedCode: null` wyłącza stały kod). */
export function updateCompany(companyId, { name, fixedCode }) {
  if (!companyRow(companyId)) throw notFound('Nie ma takiej firmy');
  if (name !== undefined) db.prepare('UPDATE spoina_companies SET name = ? WHERE id = ?').run(name, companyId);
  if (fixedCode !== undefined) {
    db.prepare('UPDATE spoina_companies SET fixed_code_hash = ? WHERE id = ?')
      .run(fixedCode === null ? null : hmac(`${companyId}:${fixedCode}`), companyId);
  }
}

// ── Logowanie ────────────────────────────────────────────────────────────────

function membersByPhone(phone) {
  return db.prepare(`
    SELECT m.company_id, m.worker_id, m.role, m.updated_at, c.name AS company_name, c.fixed_code_hash
    FROM spoina_members m JOIN spoina_companies c ON c.id = m.company_id
    WHERE m.phone = ? ORDER BY m.updated_at DESC
  `).all(phone);
}

export function memberOf(companyId, workerId) {
  const r = db.prepare('SELECT company_id, worker_id, role FROM spoina_members WHERE company_id = ? AND worker_id = ?')
    .get(companyId, workerId);
  return r ? { companyId: r.company_id, workerId: r.worker_id, role: r.role } : null;
}

const codeRow = (phone) => db.prepare('SELECT * FROM spoina_login_codes WHERE phone = ?').get(phone);

/**
 * Przygotowuje kod logowania dla numeru. Zwraca kod do wysłania SMS-em albo `null`, gdy nie
 * ma czego wysyłać (numer nieznany albo firma loguje się stałym kodem). Odpowiedź trasy jest
 * w obu przypadkach taka sama — nie zdradzamy, czy numer jest w systemie.
 * @param {string} phoneInput
 * @param {{now?:number, smsReady?:boolean}} [opts]
 */
export function startLogin(phoneInput, opts = {}) {
  const phone = canonPhone(phoneInput);
  if (!phone) throw badRequest('Podaj poprawny numer telefonu');
  const now = opts.now ?? Date.now();

  const row = codeRow(phone);
  let sentCount = row?.sent_count ?? 0;
  let windowStart = row?.window_start ? Date.parse(row.window_start) : 0;
  if (now - windowStart > CODE_WINDOW_MS) { sentCount = 0; windowStart = now; }
  if (row?.sent_at && now - Date.parse(row.sent_at) < CODE_MIN_INTERVAL_MS) {
    throw tooMany('Kod został właśnie wysłany. Odczekaj pół minuty.');
  }
  if (sentCount >= CODE_MAX_PER_WINDOW) throw tooMany('Za dużo próśb o kod. Spróbuj za godzinę.');

  const known = membersByPhone(phone).length > 0;
  const code = known && opts.smsReady ? String(crypto.randomInt(0, 1_000_000)).padStart(6, '0') : null;
  db.prepare(`
    INSERT INTO spoina_login_codes (phone, code_hash, expires_at, attempts, locked_until, sent_at, sent_count, window_start)
    VALUES (?, ?, ?, 0, NULL, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      code_hash = COALESCE(excluded.code_hash, spoina_login_codes.code_hash),
      expires_at = COALESCE(excluded.expires_at, spoina_login_codes.expires_at),
      attempts = CASE WHEN excluded.code_hash IS NULL THEN spoina_login_codes.attempts ELSE 0 END,
      sent_at = excluded.sent_at, sent_count = excluded.sent_count, window_start = excluded.window_start
  `).run(
    phone, code ? hmac(`${phone}:${code}`) : null, code ? new Date(now + CODE_TTL_MS).toISOString() : null,
    new Date(now).toISOString(), sentCount + 1, new Date(windowStart).toISOString(),
  );
  return { phone, code };
}

/**
 * Sprawdza kod i otwiera sesję urządzenia.
 * @returns {{token:string, companyId:string, companyName:string, workerId:string, role:string}}
 */
export function verifyLogin(phoneInput, codeInput, opts = {}) {
  const phone = canonPhone(phoneInput);
  const code = String(codeInput ?? '').replace(/\D/g, '');
  if (!phone || code.length < 4 || code.length > 12) throw badRequest('Podaj numer telefonu i kod');
  const now = opts.now ?? Date.now();

  const row = codeRow(phone);
  if (row?.locked_until && Date.parse(row.locked_until) > now) {
    throw tooMany('Za dużo błędnych kodów. Spróbuj ponownie za kwadrans.');
  }

  const members = membersByPhone(phone);
  let match = null;
  if (members.length && row?.code_hash && row.expires_at && Date.parse(row.expires_at) > now
    && safeEqual(row.code_hash, hmac(`${phone}:${code}`))) {
    match = members[0];
  } else {
    match = members.find((m) => m.fixed_code_hash && safeEqual(m.fixed_code_hash, hmac(`${m.company_id}:${code}`))) ?? null;
  }

  if (!match) {
    const attempts = (row?.attempts ?? 0) + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    db.prepare(`
      INSERT INTO spoina_login_codes (phone, attempts, locked_until, sent_count) VALUES (?, ?, ?, 0)
      ON CONFLICT(phone) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until,
        code_hash = CASE WHEN excluded.locked_until IS NULL THEN spoina_login_codes.code_hash ELSE NULL END
    `).run(phone, lock ? 0 : attempts, lock ? new Date(now + LOCK_MS).toISOString() : null);
    throw unauthorized('Błędny kod');
  }

  db.prepare('UPDATE spoina_login_codes SET code_hash = NULL, expires_at = NULL, attempts = 0, locked_until = NULL WHERE phone = ?')
    .run(phone);
  const token = crypto.randomBytes(32).toString('hex');
  const iso = new Date(now).toISOString();
  db.prepare('INSERT INTO spoina_sessions (token_hash, company_id, worker_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), match.company_id, match.worker_id, iso, iso, new Date(now + SESSION_TTL_MS).toISOString());
  return {
    token, companyId: match.company_id, companyName: match.company_name, workerId: match.worker_id, role: match.role,
  };
}

/** Osoba dla tokenu sesji albo `null`. Rola jest czytana na bieżąco — zmiana działa od razu. */
export function sessionMember(token, opts = {}) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const now = opts.now ?? Date.now();
  const hash = sha256(token);
  const s = db.prepare('SELECT company_id, worker_id, last_seen_at, expires_at FROM spoina_sessions WHERE token_hash = ?').get(hash);
  if (!s) return null;
  if (Date.parse(s.expires_at) <= now) {
    db.prepare('DELETE FROM spoina_sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  const member = memberOf(s.company_id, s.worker_id);
  if (!member) return null;
  if (now - Date.parse(s.last_seen_at) > SEEN_EVERY_MS) {
    db.prepare('UPDATE spoina_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString(), hash);
  }
  return { ...member, tokenHash: hash };
}

export function endSession(token) {
  db.prepare('DELETE FROM spoina_sessions WHERE token_hash = ?').run(sha256(String(token)));
}

export function companyName(companyId) {
  return companyRow(companyId)?.name ?? '';
}

/** Skrót tokenu — klucz limitera żądań (nie trzymamy surowych tokenów w pamięci limitera). */
export const tokenKey = (token) => sha256(String(token)).slice(0, 24);
