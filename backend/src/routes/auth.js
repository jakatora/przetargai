import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { users, tenders } from '../db/repos.js';
import { isValidNip, normalizeNip } from '../lib/nip.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publicUser } from '../lib/serialize.js';
import { createUpgradeLink } from '../services/magicLink.js';
import { sendEmail, welcomeEmail } from '../services/email.js';
import { generateMatchesForUser } from '../jobs/fetchTenders.js';
import { logger } from '../lib/logger.js';

const router = Router();

/** Waliduje body schematem zod; rzuca AppError 400 z listą pól. */
function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Błąd walidacji danych', result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })));
  }
  return result.data;
}

// ---------------- rejestracja ----------------

const registerSchema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
  password: z.string().min(8, 'Hasło musi mieć min. 8 znaków').max(200),
  company_nip: z.string().min(1, 'NIP jest wymagany'),
  company_name: z.string().min(2, 'Nazwa firmy min. 2 znaki').max(200),
  keywords: z.array(z.string().min(1).max(60)).max(30).optional().default([]),
  cpv_codes: z.array(z.string().min(1).max(20)).max(30).optional().default([]),
});

router.post('/register', ah(async (req, res) => {
  const data = parseBody(registerSchema, req.body);

  const nip = normalizeNip(data.company_nip);
  if (!isValidNip(nip)) throw badRequest('Nieprawidłowy NIP (niepoprawna suma kontrolna)');

  const email = data.email.toLowerCase().trim();
  if (users.findByEmail(email)) throw conflict('Konto z tym adresem email już istnieje');
  if (users.findByNip(nip)) throw conflict('Firma z tym numerem NIP jest już zarejestrowana');

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = users.create({
    companyNip: nip,
    companyName: data.company_name.trim(),
    email,
    passwordHash,
    keywords: data.keywords,
    cpvCodes: data.cpv_codes,
  });

  audit({ userId: user.id, action: 'register', ip: req.ip });
  sendEmail({ to: email, ...welcomeEmail(user.company_name) })
    .catch((err) => logger.error({ err: err.message }, 'Email powitalny nie wysłany'));

  // Onboarding backfill: jeśli user dał keywords/CPV, dopasuj go do aktualnych
  // tenderów w bazie. Fire-and-forget — nie blokuje response. Bez tego feed
  // byłby pusty do następnego cron BZP (co 6h).
  if (user.keywords.length || user.cpv_codes.length) {
    const candidates = tenders.recent(200);
    generateMatchesForUser(user, candidates)
      .then((r) => logger.info({ userId: user.id, ...r }, 'Onboarding matching zakończony'))
      .catch((err) => logger.error({ err: err.message, userId: user.id }, 'Onboarding matching nieudany'));
  }

  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
}));

// ---------------- logowanie ----------------

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Hash-atrapa — utrzymuje stały czas odpowiedzi, gdy konto nie istnieje.
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789012345678901234567890';

router.post('/login', ah(async (req, res) => {
  const data = parseBody(loginSchema, req.body);
  const user = users.findByEmail(data.email.toLowerCase().trim());
  const ok = await bcrypt.compare(data.password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !ok) {
    audit({ userId: user?.id ?? null, action: 'login_failed', ip: req.ip });
    throw unauthorized('Nieprawidłowy email lub hasło');
  }

  audit({ userId: user.id, action: 'login', ip: req.ip });
  res.json({ token: signToken(user.id), user: publicUser(user) });
}));

// ---------------- profil ----------------

router.get('/me', authRequired, ah(async (req, res) => {
  audit({ userId: req.user.id, action: 'view_profile', ip: req.ip });
  res.json({ user: publicUser(req.user) });
}));

const profileSchema = z.object({
  company_name: z.string().min(2).max(200).optional(),
  keywords: z.array(z.string().min(1).max(60)).max(30).optional(),
  cpv_codes: z.array(z.string().min(1).max(20)).max(30).optional(),
});

router.patch('/me', authRequired, ah(async (req, res) => {
  const data = parseBody(profileSchema, req.body);
  const updated = users.updateProfile(req.user.id, {
    companyName: data.company_name ?? req.user.company_name,
    keywords: data.keywords ?? req.user.keywords,
    cpvCodes: data.cpv_codes ?? req.user.cpv_codes,
  });
  audit({ userId: req.user.id, action: 'update_profile', ip: req.ip });
  res.json({ user: publicUser(updated) });
}));

const pushTokenSchema = z.object({ push_token: z.string().min(1).max(300) });

router.put('/me/push-token', authRequired, ah(async (req, res) => {
  const data = parseBody(pushTokenSchema, req.body);
  users.setPushToken(req.user.id, data.push_token);
  res.json({ ok: true });
}));

// ---------------- magic link do checkoutu ----------------

router.post('/upgrade-link', authRequired, ah(async (req, res) => {
  if (req.user.premium_tier === 'standard') {
    throw badRequest('Subskrypcja Standard jest już aktywna');
  }
  const link = createUpgradeLink(req.user.id);
  audit({ userId: req.user.id, action: 'create_upgrade_link', ip: req.ip });
  res.json(link);
}));

export default router;
