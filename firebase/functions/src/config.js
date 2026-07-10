import { z } from 'zod';
import { isModelPriced } from './lib/pricing.js';

/*
 * Konfiguracja Functions. Źródła wartości:
 *  • produkcja: Secret Manager (defineSecret w index.js wiąże sekret z funkcją,
 *    a runtime wystawia go w process.env pod tą samą nazwą),
 *  • emulator/testy: plik functions/.env.local (gitignored) — firebase-functions
 *    ładuje pliki .env* automatycznie.
 * Zniknęły względem Railway: PORT (nadaje platforma), DATABASE_PATH (Firestore),
 * BACKUP_* i B2_* (zarządzane kopie Firestore), TENDER_FETCH_CRON i SCHEDULER_TZ
 * (harmonogram deklarowany w onSchedule w index.js — patrz D-021).
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  APP_NAME: z.string().default('PrzetargAI'),
  // Publiczny adres API — do linków w mailach (magic link, upgrade).
  // Po podpięciu custom domain: https://api.przetargai.pl
  APP_URL: z.string().url().default('https://europe-central2-przetargai.cloudfunctions.net/api'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET musi mieć min. 16 znaków'),
  JWT_TTL_DAYS: z.coerce.number().int().positive().default(30),

  ANTHROPIC_API_KEY: z.string().default(''),
  AI_MATCH_MODEL: z.string().default('claude-haiku-4-5'),
  AI_BUDGET_SOFT_USD: z.coerce.number().nonnegative().default(200),
  AI_BUDGET_HARD_USD: z.coerce.number().nonnegative().default(500),
  AI_RERANK_TOP_N: z.coerce.number().int().nonnegative().default(30),

  STRIPE_PUBLISHABLE_KEY: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_STANDARD: z.string().default(''),
  STRIPE_PRICE_PRO: z.string().default(''),

  // Fakturowanie WYŁĄCZONE decyzją usera 2026-07-10 (D-048): „na razie nie
  // wystawiamy faktur". Włączenie = zmiana defaulta na 'true' + deploy
  // (sekrety FAKTUROWNIA_* zostają w Secret Managerze na tę chwilę).
  FAKTUROWANIE_ENABLED: z.enum(['true', 'false']).default('false'),
  FAKTUROWNIA_API_KEY: z.string().default(''),
  FAKTUROWNIA_DOMAIN: z.string().default(''),

  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('PrzetargAI <noreply@przetargai.pl>'),
  EMAIL_REPLY_TO: z.string().default('support@przetargai.pl'),

  ADMIN_API_KEY: z.string().default(''),

  BZP_API_BASE_URL: z.string().url().default('https://ezamowienia.gov.pl/mo-board/api/v1'),
  BZP_SEARCH_PATH: z.string().default('/notice'),
  BZP_NOTICE_TYPE: z.string().default('ContractNotice'),
  BZP_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),

  // TED — polskie postępowania POWYŻEJ progów UE (nie ma ich w BZP). API publiczne,
  // bez klucza (zweryfikowane 2026-07-10). 'false' wyłącza źródło bez deployu kodu.
  TED_ENABLED: z.enum(['true', 'false']).default('true'),
  TED_API_BASE_URL: z.string().url().default('https://api.ted.europa.eu'),
  TED_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),

  MATCH_CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(60),
  FREE_TIER_DAILY_MATCH_LIMIT: z.coerce.number().int().positive().default(5),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  throw new Error(`Błędna konfiguracja środowiska: ${issues}`);
}

export const env = parsed.data;

/** Flagi funkcji — brak klucza = tryb ograniczony zamiast wywrotki backendu. */
export const features = {
  ai: Boolean(env.ANTHROPIC_API_KEY),
  stripe: Boolean(env.STRIPE_SECRET_KEY),
  email: Boolean(env.RESEND_API_KEY),
  invoicing: env.FAKTUROWANIE_ENABLED === 'true' && Boolean(env.FAKTUROWNIA_API_KEY && env.FAKTUROWNIA_DOMAIN),
  ted: env.TED_ENABLED === 'true',
};

/*
 * Model AI musi mieć zweryfikowaną cenę, inaczej monitoring budżetu mierzy złą
 * liczbę (D-020). Fail-fast przy zimnym starcie funkcji, nie przy pierwszym
 * wywołaniu AI o 12:05 w cronie.
 */
if (features.ai && !isModelPriced(env.AI_MATCH_MODEL)) {
  throw new Error(
    `AI_MATCH_MODEL="${env.AI_MATCH_MODEL}" nie ma zweryfikowanej ceny w lib/pricing.js — `
    + 'monitoring budżetu byłby ślepy. Ustaw claude-haiku-4-5 albo dopisz cenę.',
  );
}
