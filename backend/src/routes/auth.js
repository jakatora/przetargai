import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { users } from '../db/repos.js';
import { isValidNip, normalizeNip } from '../lib/nip.js';
import { badRequest, conflict, unauthorized, forbidden } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publicUser } from '../lib/serialize.js';
import { createUpgradeLink } from '../services/magicLink.js';
import { sendEmail, welcomeEmail } from '../services/email.js';
import { backfillUser } from '../services/matching.js';
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

// NIP i nazwa firmy są OPCJONALNE (feedback usera 2026-07-09 + plan §7):
// persona JDG rejestruje się samym e-mailem; NIP schodzi do faktury.
const registerSchema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
  password: z.string().min(8, 'Hasło musi mieć min. 8 znaków').max(200),
  company_nip: z.string().max(20).optional(),
  company_name: z.string().min(2, 'Nazwa firmy min. 2 znaki').max(200).optional(),
  keywords: z.array(z.string().min(1).max(60)).max(30).optional().default([]),
  cpv_codes: z.array(z.string().min(1).max(20)).max(30).optional().default([]),
});

router.post('/register', ah(async (req, res) => {
  const data = parseBody(registerSchema, req.body);

  // NIP podany dobrowolnie nadal przechodzi pełną walidację i musi być unikalny.
  let nip = null;
  if (data.company_nip?.trim()) {
    nip = normalizeNip(data.company_nip);
    if (!isValidNip(nip)) throw badRequest('Nieprawidłowy NIP (niepoprawna suma kontrolna)');
    if (users.findByNip(nip)) throw conflict('Firma z tym numerem NIP jest już zarejestrowana');
  }

  const email = data.email.toLowerCase().trim();
  if (users.findByEmail(email)) throw conflict('Konto z tym adresem email już istnieje');

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = users.create({
    companyNip: nip,
    companyName: data.company_name?.trim() ?? null,
    email,
    passwordHash,
    keywords: data.keywords,
    cpvCodes: data.cpv_codes,
  });

  audit({ userId: user.id, action: 'register', ip: req.ip });
  sendEmail({ to: email, ...welcomeEmail(user.company_name) })
    .catch((err) => logger.error({ err: err.message }, 'Email powitalny nie wysłany'));

  // Onboarding backfill: jeśli user dał keywords/CPV, dopasuj go do istniejących
  // przetargów z otwartym terminem. Fire-and-forget — nie blokuje response.
  // Bez tego feed byłby pusty do następnego cyklu cron (do 24 h).
  if (user.keywords.length || user.cpv_codes.length) {
    backfillUser(user)
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

  // Zmiana kryteriów => natychmiastowa re-ocena ISTNIEJĄCYCH przetargów (§6.14
  // planu). Bez tego nowe słowo kluczowe działało wyłącznie na ogłoszenia
  // opublikowane po zmianie — profil wyglądał na zepsuty. Fire-and-forget.
  const criteriaChanged =
    (data.keywords && JSON.stringify(data.keywords) !== JSON.stringify(req.user.keywords))
    || (data.cpv_codes && JSON.stringify(data.cpv_codes) !== JSON.stringify(req.user.cpv_codes));
  if (criteriaChanged) {
    backfillUser(updated)
      .then((r) => logger.info({ userId: updated.id, ...r }, 'Re-matching po zmianie profilu zakończony'))
      .catch((err) => logger.error({ err: err.message, userId: updated.id }, 'Re-matching po zmianie profilu nieudany'));
  }

  res.json({ user: publicUser(updated) });
}));

const pushTokenSchema = z.object({ push_token: z.string().min(1).max(300) });

router.put('/me/push-token', authRequired, ah(async (req, res) => {
  const data = parseBody(pushTokenSchema, req.body);
  users.setPushToken(req.user.id, data.push_token);
  res.json({ ok: true });
}));

// ---------------- usunięcie konta (RODO art. 17) ----------------

const usuniecieSchema = z.object({
  password: z.string().min(1, 'Podaj hasło, aby potwierdzić usunięcie konta'),
});

/**
 * Trwale usuwa konto i wszystkie dane użytkownika.
 *
 * Ten sam kontrakt co w wersji na Firebase — aplikacja mobilna wskazuje jeszcze
 * na ten backend, a bez tej trasy nowy ekran „Usunięcie konta" dostawałby 404
 * (audyt 2026-07-10). Hasło potwierdza operację nieodwracalną; aktywna subskrypcja
 * blokuje usunięcie, bo ten backend nie anuluje subskrypcji w Stripe.
 */
router.delete('/me', authRequired, ah(async (req, res) => {
  const data = parseBody(usuniecieSchema, req.body);

  /*
   * Złe hasło daje 403, a NIE 401. Klient mobilny traktuje każde 401 na trasie
   * z tokenem jako wygasłą sesję i wylogowuje globalnie — literówka w haśle
   * potwierdzającym wyrzucałaby użytkownika na ekran logowania zamiast pokazać
   * komunikat (audyt 2026-07-10, kolizja dwóch napraw). Token jest tu ważny;
   * odmawiamy operacji, nie sesji.
   */
  const poprawne = await bcrypt.compare(data.password, req.user.password_hash);
  if (!poprawne) throw forbidden('Nieprawidłowe hasło');

  if (req.user.premium_tier === 'standard') {
    throw badRequest('Najpierw anuluj subskrypcję — inaczej Stripe obciąży kartę za usunięte konto');
  }

  // Audyt PRZED usunięciem: potem nie ma już do czego się odwołać.
  audit({ userId: req.user.id, action: 'delete_account', ip: req.ip });
  users.usunKonto(req.user.id);
  logger.info({ userId: req.user.id }, 'Konto usunięte na żądanie użytkownika');

  res.json({ ok: true, message: 'Konto i wszystkie dane zostały trwale usunięte' });
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
