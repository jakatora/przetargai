import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { adminRequired } from '../middleware/adminAuth.js';
import {
  applyChanges, companyName, companyRev, createCompany, endSession, listCompanies, pull,
  sessionMember, startLogin, tokenKey, updateCompany, verifyLogin, zmiany,
} from '../services/spoinaStore.js';
import { sendLoginCode, smsEnabled } from '../services/spoinaSms.js';

/*
 * Spoina — aplikacja firmy spawalniczej (kadry, budowy, delegowanie ekip, sprzęt).
 *
 *   POST /auth/start   { phone }          → wysyła kod SMS-em (odpowiedź zawsze taka sama)
 *   POST /auth/verify  { phone, code }    → { token, companyId, companyName, workerId, role }
 *   POST /auth/logout
 *   GET  /me
 *   GET  /docs?since=<rev>&wait=<s>       → dokumenty firmy widoczne dla tej osoby; `wait`
 *                                           trzyma połączenie do pierwszej zmiany (na żywo)
 *   POST /docs         { changes }        → zapis zmian pól, pod kontrolą uprawnień roli
 *   /admin/companies                      → zakładanie firm (nagłówek x-admin-key)
 *
 * Uprawnienia ról: services/spoinaRules.js. Dane i sesje: services/spoinaStore.js.
 */

const router = Router();

const bearer = (req) => {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};

// Logowanie: mało prób z jednego adresu — kod ma 6 cyfr, a każda wysyłka to koszt SMS-a.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Za dużo prób logowania. Spróbuj za kwadrans.' } },
});
// Dane: limit na URZĄDZENIE, nie na adres — cała ekipa na jednym Wi-Fi budowy to jeden adres IP.
const docsLimiter = rateLimit({
  windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => {
    const token = bearer(req);
    return token ? `spoina:${tokenKey(token)}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
  },
});
const adminLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

/** Middleware: wymaga ważnej sesji urządzenia; ustawia `req.spoina`. */
function sessionRequired(req, res, next) {
  const member = sessionMember(bearer(req));
  if (!member) return next(unauthorized('Sesja wygasła. Zaloguj się ponownie.'));
  req.spoina = member;
  next();
}

// ── Logowanie ────────────────────────────────────────────────────────────────

const startSchema = z.object({ phone: z.string().min(6).max(32) });
const verifySchema = z.object({ phone: z.string().min(6).max(32), code: z.string().min(4).max(16) });

router.post('/auth/start', authLimiter, ah(async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Podaj numer telefonu');
  const { phone, code } = startLogin(parsed.data.phone, { smsReady: smsEnabled() });
  if (code) {
    // Błąd bramki SMS nie zmienia odpowiedzi — inaczej dałoby się sprawdzać, czyj numer jest w systemie.
    try {
      await sendLoginCode(phone, code);
    } catch (err) {
      logger.error({ err: err.message, phone: `…${phone.slice(-3)}` }, 'Spoina: nie udało się wysłać kodu SMS');
    }
  }
  res.json({ ok: true });
}));

router.post('/auth/verify', authLimiter, ah(async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Podaj numer telefonu i kod');
  res.json(verifyLogin(parsed.data.phone, parsed.data.code));
}));

router.post('/auth/logout', docsLimiter, sessionRequired, (req, res) => {
  endSession(bearer(req));
  res.json({ ok: true });
});

router.get('/me', docsLimiter, sessionRequired, (req, res) => {
  const { companyId, workerId, role } = req.spoina;
  res.json({ companyId, companyName: companyName(companyId), workerId, role });
});

// ── Dokumenty firmy ──────────────────────────────────────────────────────────

const MAX_WAIT_S = 25;

router.get('/docs', docsLimiter, sessionRequired, ah(async (req, res) => {
  const since = /^\d+$/.test(String(req.query.since ?? '')) ? Number(req.query.since) : null;
  const wait = Math.min(Math.max(Number(req.query.wait) || 0, 0), MAX_WAIT_S);
  let member = req.spoina;

  if (wait > 0 && since !== null && companyRev(member.companyId) === since) {
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        zmiany.off(member.companyId, done);
        res.off('close', done);
        resolve();
      };
      const timer = setTimeout(done, wait * 1000);
      zmiany.once(member.companyId, done);
      res.once('close', done); // urządzenie się rozłączyło — nie trzymamy słuchacza
    });
    if (res.destroyed || res.writableEnded) return;
    // W trakcie czekania osoba mogła stracić dostęp albo zmienić rolę.
    member = sessionMember(bearer(req));
    if (!member) throw unauthorized('Sesja wygasła. Zaloguj się ponownie.');
  }
  res.json(pull(member, since));
}));

router.post('/docs', docsLimiter, sessionRequired, ah(async (req, res) => {
  const changes = req.body?.changes;
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
    throw badRequest('Wymagane pole changes');
  }
  const result = applyChanges(req.spoina, changes);
  if (result.rejected.length) {
    logger.warn({ company: req.spoina.companyId, role: req.spoina.role, rejected: result.rejected.slice(0, 5) },
      'Spoina: odrzucone zmiany');
  }
  res.json(result);
}));

// ── Administracja: zakładanie firm ───────────────────────────────────────────

const fixedCode = z.string().regex(/^\d{6,12}$/, 'stały kod to 6–12 cyfr');
const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  ownerPhone: z.string().min(6).max(32),
  // Własne id pierwszej osoby — gdy firma jest zakładana pod gotowy zestaw danych (firma pokazowa).
  ownerId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  fixedCode: fixedCode.optional(),
});
const companyPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  fixedCode: fixedCode.nullable().optional(),
});

router.get('/admin/companies', adminLimiter, adminRequired, (req, res) => {
  res.json({ companies: listCompanies(), sms: smsEnabled() });
});

router.post('/admin/companies', adminLimiter, adminRequired, ah(async (req, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Błędne dane firmy', parsed.error.issues.map((i) => i.message));
  const created = createCompany(parsed.data);
  logger.info({ company: created.companyId }, 'Spoina: założono firmę');
  res.status(201).json(created);
}));

router.patch('/admin/companies/:id', adminLimiter, adminRequired, ah(async (req, res) => {
  const parsed = companyPatchSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Błędne dane firmy', parsed.error.issues.map((i) => i.message));
  updateCompany(req.params.id, parsed.data);
  res.json({ ok: true });
}));

export default router;
