import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { users } from '../db/repos.js';
import { isValidNip, normalizeNip } from '../lib/nip.js';
import { badRequest, conflict, unauthorized, forbidden, serviceUnavailable } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publicUser } from '../lib/serialize.js';
import { createUpgradeLink } from '../services/magicLink.js';
import { anulujSubskrypcje } from '../services/stripe.js';
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

  // NIP podany dobrowolnie nadal przechodzi pełną walidację sumy kontrolnej.
  // Unikalności e-maila i NIP-u NIE sprawdzamy osobnym zapytaniem (wyścig na
  // Firestore) — egzekwuje ją users.create() dokumentami rezerwacji i rzuca
  // DUPLICATE_EMAIL / DUPLICATE_NIP, które łapiemy niżej.
  let nip = null;
  if (data.company_nip?.trim()) {
    nip = normalizeNip(data.company_nip);
    if (!isValidNip(nip)) throw badRequest('Nieprawidłowy NIP (niepoprawna suma kontrolna)');
  }

  const email = data.email.toLowerCase().trim();

  // Hash liczymy przed create(): bez pre-checku duplikatu nie da się go pominąć
  // dla istniejącego konta, a create() i tak jest jedynym arbitrem unikalności.
  const passwordHash = await bcrypt.hash(data.password, 12);

  let user;
  try {
    user = await users.create({
      companyNip: nip,
      companyName: data.company_name?.trim() ?? null,
      email,
      passwordHash,
      keywords: data.keywords,
      cpvCodes: data.cpv_codes,
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_EMAIL') throw conflict('Konto z tym adresem email już istnieje');
    if (err.code === 'DUPLICATE_NIP') throw conflict('Firma z tym numerem NIP jest już zarejestrowana');
    throw err;
  }

  audit({ userId: user.id, action: 'register', ip: req.ip });
  /*
   * BŁĄD PRODUKCYJNY (D-044): te operacje były fire-and-forget, a Cloud Functions
   * ZAMRAŻAJĄ instancję po wysłaniu odpowiedzi — backfill nigdy się nie kończył
   * i świeży użytkownik z dobrymi słowami kluczowymi dostawał PUSTY feed do
   * najbliższego crona (emulator maskował problem, bo jego proces żyje dalej).
   * CZEKAMY więc przed odpowiedzią. Koszt: rejestracja trwa do kilku sekund
   * (heurystyka po puli + góra `aiQuota` wywołań AI) — to cena poprawności.
   * Błędy nadal nie wywracają rejestracji (konto już istnieje).
   */
  const [mail, onboarding] = await Promise.allSettled([
    sendEmail({ to: email, ...welcomeEmail(user.company_name) }),
    (user.keywords.length || user.cpv_codes.length)
      ? backfillUser(user, { wymus: true })
      : Promise.resolve(null),
  ]);
  if (mail.status === 'rejected') {
    logger.error({ err: mail.reason?.message }, 'Email powitalny nie wysłany');
  }
  if (onboarding.status === 'rejected') {
    logger.error({ err: onboarding.reason?.message, userId: user.id }, 'Onboarding matching nieudany');
  } else if (onboarding.value) {
    logger.info({ userId: user.id, ...onboarding.value }, 'Onboarding matching zakończony');
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
  const user = await users.findByEmail(data.email.toLowerCase().trim());
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
  const updated = await users.updateProfile(req.user.id, {
    companyName: data.company_name ?? req.user.company_name,
    keywords: data.keywords ?? req.user.keywords,
    cpvCodes: data.cpv_codes ?? req.user.cpv_codes,
  });
  audit({ userId: req.user.id, action: 'update_profile', ip: req.ip });

  // Zmiana kryteriów => natychmiastowa re-ocena ISTNIEJĄCYCH przetargów (§6.14
  // planu). Bez tego nowe słowo kluczowe działało wyłącznie na ogłoszenia
  // opublikowane po zmianie — profil wyglądał na zepsuty.
  // AWAIT przed odpowiedzią (D-044): Functions zamrażają tło po response —
  // fire-and-forget nigdy nie kończył pracy na produkcji. Cooldown backfillu
  // (10 min) nadal chroni przed lawiną odczytów puli przy klikaniu w kółko.
  const criteriaChanged =
    (data.keywords && JSON.stringify(data.keywords) !== JSON.stringify(req.user.keywords))
    || (data.cpv_codes && JSON.stringify(data.cpv_codes) !== JSON.stringify(req.user.cpv_codes));
  if (criteriaChanged) {
    try {
      const wynik = await backfillUser(updated);
      logger.info({ userId: updated.id, ...wynik }, 'Re-matching po zmianie profilu zakończony');
    } catch (err) {
      // Profil już zapisany — feed dogoni przy najbliższym cronie.
      logger.error({ err: err.message, userId: updated.id }, 'Re-matching po zmianie profilu nieudany');
    }
  }

  res.json({ user: publicUser(updated) });
}));

const pushTokenSchema = z.object({ push_token: z.string().min(1).max(300) });

router.put('/me/push-token', authRequired, ah(async (req, res) => {
  const data = parseBody(pushTokenSchema, req.body);
  await users.setPushToken(req.user.id, data.push_token);
  res.json({ ok: true });
}));

// ---------------- usunięcie konta (RODO art. 17) ----------------

const usuniecieSchema = z.object({
  password: z.string().min(1, 'Podaj hasło, aby potwierdzić usunięcie konta'),
});

/**
 * Trwale usuwa konto i wszystkie dane użytkownika.
 *
 * Wymagamy hasła, mimo że żądanie jest już uwierzytelnione tokenem: to operacja
 * nieodwracalna, a token bywa dostępny na urządzeniu, które nie jest w rękach
 * właściciela.
 *
 * Aktywna subskrypcja NIE blokuje usunięcia (audyt 2026-07-10) — RODO art. 17
 * i wymóg Google Play nie znają wyjątku „bo klient płaci". Zamiast odmawiać,
 * anulujemy subskrypcję w Stripe, żeby karta nie była obciążana za konto,
 * którego już nie ma. Kolejność jest istotna: najpierw Stripe (operacja, która
 * może się nie powieść i którą wolno powtórzyć), potem nieodwracalne kasowanie.
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

  if (req.user.stripe_subscription_id) {
    try {
      const anulowana = await anulujSubskrypcje(req.user.stripe_subscription_id);
      logger.info({ userId: req.user.id, anulowana }, 'Subskrypcja zamknięta przed usunięciem konta');
    } catch (err) {
      // Nie kasujemy konta, dopóki nie mamy pewności, że karta przestanie być
      // obciążana. Użytkownik może spróbować ponownie; dane wciąż są nietknięte.
      logger.error({ err: err.message, userId: req.user.id }, 'Nie udało się anulować subskrypcji');
      throw serviceUnavailable(
        'Nie udało się anulować subskrypcji. Spróbuj ponownie za chwilę — konto nie zostało usunięte.',
      );
    }

    /*
     * Subskrypcji już nie ma, więc konto NIE MOŻE dalej mieć planu Standard.
     * Gdyby kasowanie padło poniżej (awaria Firestore), użytkownik zostałby
     * z płatnym planem, za który nikt nie płaci — i korzystał z niego za darmo,
     * dopóki ktoś by nie zauważył. Zdejmujemy plan od razu.
     */
    await users.setTier(req.user.id, 'free').catch((err) =>
      logger.error({ err: err.message, userId: req.user.id }, 'Nie udało się zdjąć planu przed usunięciem'));
    await users.setStripeSubscription(req.user.id, null).catch(() => {});
  }

  // Audyt PRZED usunięciem: po nim nie ma już do czego się odwołać.
  audit({ userId: req.user.id, action: 'delete_account', ip: req.ip });
  await users.usunKonto(req.user.id);
  logger.info({ userId: req.user.id }, 'Konto usunięte na żądanie użytkownika');

  res.json({ ok: true, message: 'Konto i wszystkie dane zostały trwale usunięte' });
}));

// ---------------- magic link do checkoutu ----------------

router.post('/upgrade-link', authRequired, ah(async (req, res) => {
  if (req.user.premium_tier === 'standard') {
    throw badRequest('Subskrypcja Standard jest już aktywna');
  }
  const link = await createUpgradeLink(req.user.id);
  audit({ userId: req.user.id, action: 'create_upgrade_link', ip: req.ip });
  res.json(link);
}));

export default router;
