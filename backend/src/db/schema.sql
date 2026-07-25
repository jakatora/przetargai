-- PrzetargAI — schemat bazy danych (SQLite). Idempotentny: CREATE ... IF NOT EXISTS.

-- Użytkownicy / firmy. Profil (keywords, cpv_codes) jest niezbędny do matchingu.
-- NIP i nazwa firmy są OPCJONALNE (migracja 001) — persona JDG rejestruje się
-- samym e-mailem; NIP schodzi do momentu wystawienia faktury.
CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  company_nip            TEXT UNIQUE,
  company_name           TEXT,
  email                  TEXT NOT NULL UNIQUE,
  password_hash          TEXT NOT NULL,
  premium_tier           TEXT NOT NULL DEFAULT 'free'
                           CHECK (premium_tier IN ('free', 'standard')),
  keywords               TEXT NOT NULL DEFAULT '[]',   -- JSON: string[]
  cpv_codes              TEXT NOT NULL DEFAULT '[]',   -- JSON: string[]
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  push_token             TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

-- Ogłoszenia o przetargach pobrane z BZP (raw_data = pełna surowa odpowiedź).
CREATE TABLE IF NOT EXISTS tenders (
  id              TEXT PRIMARY KEY,
  bzp_external_id TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  organization    TEXT,
  cpv_main        TEXT,
  budget          REAL,
  currency        TEXT NOT NULL DEFAULT 'PLN',
  deadline        TEXT,
  url             TEXT,
  raw_data        TEXT NOT NULL DEFAULT '{}',
  published_at    TEXT,
  fetched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenders_published ON tenders(published_at);
CREATE INDEX IF NOT EXISTS idx_tenders_fetched ON tenders(fetched_at);

-- Dopasowania przetargów do użytkowników.
CREATE TABLE IF NOT EXISTS matches (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tender_id        TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  match_reasoning  TEXT,
  scorer           TEXT NOT NULL DEFAULT 'ai',   -- 'ai' | 'heuristic'
  notified         INTEGER NOT NULL DEFAULT 0,   -- 0/1
  created_at       TEXT NOT NULL,
  UNIQUE (user_id, tender_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_user_created ON matches(user_id, created_at);

-- Feedback użytkownika do dopasowań (doskonalenie preferencji).
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  helpful    INTEGER NOT NULL,   -- 0/1
  created_at TEXT NOT NULL,
  UNIQUE (user_id, match_id)
);

-- Dziennik audytu dostępu do danych (RODO).
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);

-- Zużycie i koszt AI — podstawa monitoringu budżetu (limit miękki/twardy).
CREATE TABLE IF NOT EXISTS ai_usage (
  id            TEXT PRIMARY KEY,
  operation     TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);

-- Magic linki (jednorazowe, krótkotrwałe) — m.in. checkout subskrypcji.
CREATE TABLE IF NOT EXISTS magic_links (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

-- Dobowy limit płatnych wywołań AI na urządzenie (migracja 003).
CREATE TABLE IF NOT EXISTS ai_quota_device (
  device_id  TEXT NOT NULL,
  day        TEXT NOT NULL,
  operation  TEXT NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, day, operation)
);
CREATE INDEX IF NOT EXISTS idx_ai_quota_device_day ON ai_quota_device(day);

-- Rejestr obsłużonych zdarzeń Stripe — idempotencja webhooka (migracja 002).
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_events(processed_at);

-- Metadane schematu (wersjonowanie migracji).
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Fitter Welder Pro — subskrypcje Premium (osobne od PrzetargAI users —
-- Fitter MVP nie wymaga konta, identyfikuje urządzenie przez device_id).
-- Tabela aktualizowana przez Stripe webhook (metadata.project = 'fitter').
CREATE TABLE IF NOT EXISTS fitter_premium (
  device_id              TEXT PRIMARY KEY,
  plan                   TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid')),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end     TEXT,            -- ISO 8601 (z subscription.current_period_end)
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fitter_premium_sub ON fitter_premium(stripe_subscription_id);

-- Fitter Welder Pro — czat publiczny (rooms hardcoded w API, w bazie tylko
-- wiadomości). Brak konta — nickname + device_id służą do identyfikacji,
-- moderation rolling przez flag count + admin endpoint.
CREATE TABLE IF NOT EXISTS fitter_chat_message (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room          TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  text          TEXT NOT NULL,
  flags         INTEGER NOT NULL DEFAULT 0,
  hidden        INTEGER NOT NULL DEFAULT 0,    -- 1 = ukryty przez moderację
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_room_created ON fitter_chat_message(room, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_device ON fitter_chat_message(device_id);

-- Fitter Welder Pro — moduł Praca. 49 PLN za ogłoszenie via Stripe one-time
-- payment. Bez wyjątków — nawet Premium płaci. Listing jest DRAFT do momentu
-- aż webhook potwierdzi płatność, wtedy ustawia is_paid=1 i expires_at +30d.
CREATE TABLE IF NOT EXISTS fitter_job_listing (
  id                 TEXT PRIMARY KEY,
  device_id          TEXT NOT NULL,
  title              TEXT NOT NULL,
  company            TEXT NOT NULL,
  location           TEXT NOT NULL,
  rate               TEXT,
  description        TEXT NOT NULL,
  requirements_csv   TEXT,
  contact_email      TEXT,
  contact_phone      TEXT,
  is_paid            INTEGER NOT NULL DEFAULT 0,
  stripe_session_id  TEXT,
  expires_at         TEXT,                -- ISO 8601, NULL aż do payment
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_paid_created ON fitter_job_listing(is_paid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_device ON fitter_job_listing(device_id);
CREATE INDEX IF NOT EXISTS idx_job_session ON fitter_job_listing(stripe_session_id);

-- Monitoring umowy pod kątem waloryzacji (ulepszenie „pilnowanie waloryzacji i
-- pułapek w umowie", migracja 004). W chwili podpisania zapisujemy branżę
-- kontraktu (dobór wskaźnika cen GUS) i wskaźnik bazowy GUS (punkt odniesienia
-- dla późniejszego liczenia wzrostu cen). Rekord należy do użytkownika.
CREATE TABLE IF NOT EXISTS umowa_monitorowana (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branza           TEXT NOT NULL,              -- branża kontraktu (dobór wskaźnika GUS)
  wskaznik_bazowy  REAL NOT NULL,              -- wartość wskaźnika GUS w chwili podpisania (baza porównania)
  wskaznik_okres   TEXT,                       -- okres GUS bazowego (np. '2026-Q2'); opcjonalny kontekst
  data_podpisania  TEXT NOT NULL,              -- ISO 8601 — moment podpisania (domyślnie chwila zapisu)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_umowa_monitorowana_user ON umowa_monitorowana(user_id);
