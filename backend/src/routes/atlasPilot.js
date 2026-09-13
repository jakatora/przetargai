import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db/index.js';
import { fcmSenderFromEnv } from '../services/atlasPilotPush.js';

/**
 * ATLAS PILOT (nowy ATLAS, 2026-09-13) — pytania komputera właściciela do jego telefonu i odpowiedzi.
 *
 * Osobny od `/api/atlas` starego ATLAS-a (tamta rura ma jednego odbiorcę w pamięci; nowy ATLAS
 * odbierałby żądania staremu). Komputer łączy się tu wyłącznie wychodząco.
 *
 * Zasady:
 *  - komputer (`desktop_id.secret`) i telefon (`device_id.token`) mają osobne sekrety; w bazie tylko SHA-256,
 *  - telefon widzi wyłącznie pytania swojego komputera,
 *  - bieżące pytania żyją w PAMIĘCI (komputer odświeża je co kilkanaście sekund),
 *  - odpowiedź (answer_id nadany przez telefon) jest przyjmowana raz; ta sama z inną treścią → 409,
 *    treść odpowiedzi znika po potwierdzeniu przez komputer, zostaje skrót do rozpoznania ponowień,
 *  - „powiadomione" tylko, gdy push naprawdę wyszedł do co najmniej jednego telefonu.
 */

const router = Router();

const ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_MS = 10 * 60_000;
const MAX_QUESTIONS = 100;
const MAX_QUESTION_BYTES = 8_000;
const MAX_DESKTOPS = 100;
const MAX_DEVICES = 10;

let pushSender = fcmSenderFromEnv();
/** Test/konfiguracja: funkcja (tokens, message) → liczba wysłanych; null = brak FCM. */
export function setPushSender(sender) {
  pushSender = sender;
}

/** desktop_id → Map(key → pytanie). */
const questions = new Map();

let ready = false;
function ensureTables() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS atlas_pilot_desktops(
      id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, seen_at TEXT);
    CREATE TABLE IF NOT EXISTS atlas_pilot_pairings(
      code_hash TEXT PRIMARY KEY, desktop_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS atlas_pilot_devices(
      id TEXT PRIMARY KEY, desktop_id TEXT NOT NULL, token_hash TEXT NOT NULL, name TEXT NOT NULL,
      fcm_token TEXT, created_at TEXT NOT NULL, seen_at TEXT);
    CREATE TABLE IF NOT EXISTS atlas_pilot_notified(
      desktop_id TEXT NOT NULL, question_key TEXT NOT NULL, notified_at TEXT NOT NULL,
      PRIMARY KEY(desktop_id, question_key));
    CREATE TABLE IF NOT EXISTS atlas_pilot_answers(
      desktop_id TEXT NOT NULL, answer_id TEXT NOT NULL, device_id TEXT NOT NULL, question_key TEXT NOT NULL,
      payload TEXT, payload_hash TEXT NOT NULL, outcome TEXT, error TEXT, created_at TEXT NOT NULL, acked_at TEXT,
      PRIMARY KEY(desktop_id, answer_id));
  `);
  ready = true;
}

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const secret = () => crypto.randomBytes(32).toString('base64url');

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function credentials(req) {
  const header = req.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const dot = token.indexOf('.');
  return dot > 0 ? [token.slice(0, dot), token.slice(dot + 1)] : [null, null];
}

function asDesktop(req, res, next) {
  ensureTables();
  const [id, key] = credentials(req);
  const row = id && db.prepare('SELECT * FROM atlas_pilot_desktops WHERE id=?').get(id);
  if (!row || !key || !sameHash(row.secret_hash, sha(key))) return res.status(401).json({ error: 'unauthorized' });
  db.prepare('UPDATE atlas_pilot_desktops SET seen_at=? WHERE id=?').run(now(), id);
  req.desktop = row;
  return next();
}

function asDevice(req, res, next) {
  ensureTables();
  const [id, key] = credentials(req);
  const row = id && db.prepare('SELECT * FROM atlas_pilot_devices WHERE id=?').get(id);
  if (!row || !key || !sameHash(row.token_hash, sha(key))) return res.status(401).json({ error: 'unauthorized' });
  db.prepare('UPDATE atlas_pilot_devices SET seen_at=? WHERE id=?').run(now(), id);
  req.device = row;
  return next();
}

const openLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
const pilotLimiter = rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false });
router.use(pilotLimiter);

router.post('/desktop/register', openLimiter, (req, res) => {
  ensureTables();
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  if (!name) return res.status(400).json({ error: 'name required' });
  if (db.prepare('SELECT COUNT(*) AS n FROM atlas_pilot_desktops').get().n >= MAX_DESKTOPS) {
    return res.status(503).json({ error: 'registration full' });
  }
  const id = crypto.randomUUID();
  const key = secret();
  db.prepare('INSERT INTO atlas_pilot_desktops(id,secret_hash,name,created_at) VALUES (?,?,?,?)').run(id, sha(key), name, now());
  return res.status(201).json({ desktop_id: id, secret: key });
});

router.post('/desktop/pairing', asDesktop, (req, res) => {
  const bytes = crypto.randomBytes(8);
  const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  const expires = Date.now() + PAIRING_MS;
  db.prepare('DELETE FROM atlas_pilot_pairings WHERE expires_at < ? OR desktop_id=?').run(Date.now(), req.desktop.id);
  db.prepare('INSERT INTO atlas_pilot_pairings(code_hash,desktop_id,expires_at) VALUES (?,?,?)').run(sha(code), req.desktop.id, expires);
  return res.json({ code, expires_at: new Date(expires).toISOString() });
});

function publicQuestion(q) {
  const { notify, ...rest } = q;
  return rest;
}

router.put('/desktop/questions', asDesktop, async (req, res) => {
  const list = req.body?.questions;
  if (!Array.isArray(list) || list.length > MAX_QUESTIONS) return res.status(400).json({ error: 'invalid questions' });
  for (const q of list) {
    if (!q || typeof q.key !== 'string' || !q.key || Buffer.byteLength(JSON.stringify(q)) > MAX_QUESTION_BYTES) {
      return res.status(400).json({ error: 'invalid question' });
    }
  }
  const desktopId = req.desktop.id;
  questions.set(desktopId, new Map(list.map((q) => [q.key, q])));
  const keys = list.map((q) => q.key);
  const notified = new Set(
    db.prepare('SELECT question_key FROM atlas_pilot_notified WHERE desktop_id=?').all(desktopId).map((r) => r.question_key),
  );
  for (const stale of notified) {
    if (!keys.includes(stale)) {
      db.prepare('DELETE FROM atlas_pilot_notified WHERE desktop_id=? AND question_key=?').run(desktopId, stale);
      notified.delete(stale);
    }
  }
  const devices = db.prepare('SELECT fcm_token FROM atlas_pilot_devices WHERE desktop_id=?').all(desktopId);
  const tokens = devices.map((d) => d.fcm_token).filter(Boolean);
  for (const q of list) {
    if (!q.notify || notified.has(q.key) || !pushSender || !tokens.length) continue;
    const message = {
      notification: { title: `ATLAS · ${String(q.project_name || '').slice(0, 60)}`, body: String(q.text || '').slice(0, 180) },
      data: { question_key: q.key },
      android: { notification: { tag: sha(q.key).slice(0, 32) } },
    };
    try {
      if ((await pushSender(tokens, message)) > 0) {
        db.prepare('INSERT OR IGNORE INTO atlas_pilot_notified(desktop_id,question_key,notified_at) VALUES (?,?,?)')
          .run(desktopId, q.key, now());
        notified.add(q.key);
      }
    } catch {
      // Brak potwierdzenia wysyłki = brak statusu „powiadomione"; komputer spróbuje przy kolejnej synchronizacji.
    }
  }
  return res.json({
    devices: devices.length,
    notified: list.filter((q) => q.notify && notified.has(q.key)).map((q) => q.key),
    push: pushSender ? 'fcm' : 'unconfigured',
  });
});

router.get('/desktop/answers', asDesktop, (req, res) => {
  const rows = db.prepare('SELECT answer_id, device_id, question_key, payload, created_at FROM atlas_pilot_answers '
    + 'WHERE desktop_id=? AND acked_at IS NULL ORDER BY created_at').all(req.desktop.id);
  return res.json({ answers: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })) });
});

router.post('/desktop/answers/ack', asDesktop, (req, res) => {
  const results = req.body?.results;
  if (!Array.isArray(results)) return res.status(400).json({ error: 'invalid results' });
  const update = db.prepare('UPDATE atlas_pilot_answers SET outcome=?, error=?, payload=NULL, acked_at=? '
    + 'WHERE desktop_id=? AND answer_id=? AND acked_at IS NULL');
  for (const r of results) {
    if (!r || typeof r.answer_id !== 'string' || typeof r.outcome !== 'string') continue;
    update.run(r.outcome.slice(0, 40), typeof r.error === 'string' ? r.error.slice(0, 500) : null, now(), req.desktop.id, r.answer_id);
  }
  return res.json({ ok: true });
});

router.post('/device/pair', openLimiter, (req, res) => {
  ensureTables();
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : 'Telefon';
  const pairing = code && db.prepare('SELECT * FROM atlas_pilot_pairings WHERE code_hash=?').get(sha(code));
  if (!pairing || pairing.expires_at < Date.now()) return res.status(400).json({ error: 'invalid or expired code' });
  db.prepare('DELETE FROM atlas_pilot_pairings WHERE code_hash=?').run(sha(code));
  if (db.prepare('SELECT COUNT(*) AS n FROM atlas_pilot_devices WHERE desktop_id=?').get(pairing.desktop_id).n >= MAX_DEVICES) {
    return res.status(409).json({ error: 'too many devices' });
  }
  const id = crypto.randomUUID();
  const token = secret();
  db.prepare('INSERT INTO atlas_pilot_devices(id,desktop_id,token_hash,name,created_at) VALUES (?,?,?,?,?)')
    .run(id, pairing.desktop_id, sha(token), name, now());
  return res.status(201).json({ device_id: id, token });
});

router.put('/device/push-token', asDevice, (req, res) => {
  const token = req.body?.fcm_token;
  if (typeof token !== 'string' || !token || token.length > 4096) return res.status(400).json({ error: 'invalid token' });
  db.prepare('UPDATE atlas_pilot_devices SET fcm_token=? WHERE id=?').run(token, req.device.id);
  return res.json({ ok: true });
});

router.get('/device/questions', asDevice, (req, res) => {
  const desktop = db.prepare('SELECT seen_at FROM atlas_pilot_desktops WHERE id=?').get(req.device.desktop_id);
  const current = questions.get(req.device.desktop_id);
  return res.json({ questions: current ? [...current.values()].map(publicQuestion) : [], desktop_seen_at: desktop?.seen_at ?? null });
});

router.post('/device/answers', asDevice, (req, res) => {
  const { answer_id: answerId, question_key: key, payload } = req.body || {};
  if (typeof answerId !== 'string' || !ID.test(answerId) || typeof key !== 'string' || !payload || typeof payload !== 'object'
    || Buffer.byteLength(JSON.stringify(payload)) > MAX_QUESTION_BYTES) {
    return res.status(400).json({ error: 'invalid answer' });
  }
  const desktopId = req.device.desktop_id;
  const hash = sha(JSON.stringify({ key, payload }));
  const existing = db.prepare('SELECT payload_hash FROM atlas_pilot_answers WHERE desktop_id=? AND answer_id=?').get(desktopId, answerId);
  if (existing) {
    return existing.payload_hash === hash
      ? res.status(202).json({ status: 'duplicate' })
      : res.status(409).json({ error: 'answer id reused with different content' });
  }
  if (!questions.get(desktopId)?.has(key)) return res.status(410).json({ error: 'question no longer open' });
  db.prepare('INSERT INTO atlas_pilot_answers(desktop_id,answer_id,device_id,question_key,payload,payload_hash,created_at) '
    + 'VALUES (?,?,?,?,?,?,?)').run(desktopId, answerId, req.device.id, key, JSON.stringify(payload), hash, now());
  return res.status(202).json({ status: 'accepted' });
});

router.get('/device/answers/:answerId', asDevice, (req, res) => {
  const row = db.prepare('SELECT outcome, error, acked_at FROM atlas_pilot_answers WHERE desktop_id=? AND answer_id=?')
    .get(req.device.desktop_id, req.params.answerId);
  if (!row) return res.status(404).json({ error: 'not found' });
  return res.json({ outcome: row.outcome, error: row.error, acked_at: row.acked_at });
});

export default router;
