import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { isModelPriced } from '../lib/pricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Katalog główny backendu (backend/) — config/ leży w backend/src/config. */
export const BACKEND_ROOT = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().default('PrzetargAI'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LANDING_URL: z.string().url().default('https://przetargai.pl'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET musi mieć min. 16 znaków'),
  JWT_TTL_DAYS: z.coerce.number().int().positive().default(30),

  ANTHROPIC_API_KEY: z.string().default(''),
  AI_MATCH_MODEL: z.string().default('claude-haiku-4-5'),
  AI_BUDGET_SOFT_USD: z.coerce.number().nonnegative().default(200),
  AI_BUDGET_HARD_USD: z.coerce.number().nonnegative().default(500),

  STRIPE_PUBLISHABLE_KEY: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_STANDARD: z.string().default(''),
  STRIPE_PRICE_PRO: z.string().default(''),
  // Fitter Welder Pro — added 2026-05-26. Same Stripe account, separate
  // products/prices so we can run multiple apps off one backend.
  STRIPE_PRICE_FITTER_MONTHLY: z.string().default(''),
  STRIPE_PRICE_FITTER_YEARLY: z.string().default(''),
  STRIPE_PRICE_FITTER_JOB_POST: z.string().default(''),

  FAKTUROWNIA_API_KEY: z.string().default(''),
  FAKTUROWNIA_DOMAIN: z.string().default(''),

  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('PrzetargAI <noreply@przetargai.pl>'),
  EMAIL_REPLY_TO: z.string().default('support@przetargai.pl'),

  SENTRY_DSN_BACKEND: z.string().default(''),

  B2_ACCOUNT_ID: z.string().default(''),
  B2_APP_KEY: z.string().default(''),
  B2_BUCKET: z.string().default('przetargai-backups'),
  BACKUP_ENCRYPTION_KEY: z.string().default(''),

  ADMIN_API_KEY: z.string().default(''),

  BZP_API_BASE_URL: z.string().url().default('https://ezamowienia.gov.pl/mo-board/api/v1'),
  BZP_SEARCH_PATH: z.string().default('/notice'),
  BZP_NOTICE_TYPE: z.string().default('ContractNotice'),
  BZP_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),

  DATABASE_PATH: z.string().default('./data/data.db'),
  BACKUP_DIR: z.string().default(''),
  BACKUP_CRON: z.string().default('0 3 * * *'),
  BACKUP_RETENTION: z.coerce.number().int().positive().default(14),

  // Codzienne pobieranie przetargów o 12:00 czasu polskiego (SCHEDULER_TZ).
  TENDER_FETCH_CRON: z.string().default('0 12 * * *'),
  // Radar zamówień podprogowych (poniżej 170 tys. zł, podzadanie 6/7) — codzienne
  // scalanie rozproszonych źródeł (BIP/platformy zakupowe/Baza Konkurencyjności) dla
  // KAŻDEJ zapisanej preferencji użytkownika. Kadencja jak tender-fetch (agregacja
  // ogłoszeń, nie zmiany „na ostatnią chwilę"): raz dziennie o 7:00 czasu polskiego,
  // odsunięte od waloryzacji (6:00). Płatne AI (streszczenie regulaminu) liczy się
  // TYLKO dla nowo dodanych ogłoszeń (dedup po hash_dedup), więc częstsze przebiegi
  // nie mnożą kosztu tego samego znaleziska. Brak zapisanych preferencji => no-op.
  PODPROGOWY_MONITOR_CRON: z.string().default('0 7 * * *'),
  // Maks. wywołań AI na usera na przebieg dopasowań. Pula kandydatów jest
  // rankowana darmową heurystyką; AI ocenia tylko czołówkę (§5 planu migracji).
  AI_RERANK_TOP_N: z.coerce.number().int().nonnegative().default(30),
  // Strefa dla całego harmonogramu. Produkcja (Railway) chodzi w UTC, więc bez
  // tego „12" oznaczałoby 13/14 w Polsce.
  SCHEDULER_TZ: z.string().default('Europe/Warsaw'),
  MATCH_CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(60),
  FREE_TIER_DAILY_MATCH_LIMIT: z.coerce.number().int().positive().default(5),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Błędna konfiguracja środowiska (backend/.env):');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

/** Ścieżka pliku bazy danych rozwiązana względem katalogu backendu. */
export const DB_PATH = path.isAbsolute(env.DATABASE_PATH)
  ? env.DATABASE_PATH
  : path.resolve(BACKEND_ROOT, env.DATABASE_PATH);

/** Katalog kopii zapasowych — domyślnie obok pliku bazy (ten sam wolumen). */
export const BACKUP_DIR = env.BACKUP_DIR
  ? (path.isAbsolute(env.BACKUP_DIR) ? env.BACKUP_DIR : path.resolve(BACKEND_ROOT, env.BACKUP_DIR))
  : path.join(path.dirname(DB_PATH), 'backups');

/**
 * Flagi funkcji — graceful degradation. Brak klucza API => usługa działa
 * w trybie ograniczonym zamiast wywracać cały backend.
 */
export const features = {
  ai: Boolean(env.ANTHROPIC_API_KEY),
  stripe: Boolean(env.STRIPE_SECRET_KEY),
  email: Boolean(env.RESEND_API_KEY),
  invoicing: Boolean(env.FAKTUROWNIA_API_KEY && env.FAKTUROWNIA_DOMAIN),
  sentry: Boolean(env.SENTRY_DSN_BACKEND),
  backups: Boolean(env.B2_ACCOUNT_ID && env.B2_APP_KEY),
};

/*
 * Model AI musi mieć zweryfikowaną cenę, inaczej monitoring budżetu mierzy złą
 * liczbę. Sprawdzamy przy starcie, a nie przy pierwszym wywołaniu AI: `costUsd()`
 * jest wołane wewnątrz bloku try w services/ai.js, więc rzucony tam błąd zostałby
 * połknięty jako „AI niedostępne" — o 3 w nocy, w cronie, bez alertu.
 */
if (features.ai && !isModelPriced(env.AI_MATCH_MODEL)) {
  console.error(
    `❌ AI_MATCH_MODEL="${env.AI_MATCH_MODEL}" nie ma zweryfikowanej ceny w src/lib/pricing.js.\n`
    + '   Monitoring budżetu (AI_BUDGET_SOFT_USD / AI_BUDGET_HARD_USD) byłby ślepy.\n'
    + '   Ustaw AI_MATCH_MODEL=claude-haiku-4-5 albo dopisz model do MODEL_PRICING.',
  );
  process.exit(1);
}
