-- PrzetargAI — schemat bazy danych (SQLite). Idempotentny: CREATE ... IF NOT EXISTS.

-- Użytkownicy / firmy. Profil firmy (keywords, cpv_codes) jest niezbędny do matchingu.
CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  company_nip            TEXT NOT NULL UNIQUE,
  company_name           TEXT NOT NULL,
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
