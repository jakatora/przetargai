-- NIP i nazwa firmy przestają być wymagane przy rejestracji (feedback usera
-- 2026-07-09 + plan migracji §7: persona JDG zakłada konto bez danych firmy).
-- SQLite nie zdejmie NOT NULL ALTER-em — przebudowa tabeli. Runner wyłącza
-- klucze obce na czas migracji i sprawdza spójność przed COMMIT.

CREATE TABLE users_new (
  id                     TEXT PRIMARY KEY,
  company_nip            TEXT UNIQUE,
  company_name           TEXT,
  email                  TEXT NOT NULL UNIQUE,
  password_hash          TEXT NOT NULL,
  premium_tier           TEXT NOT NULL DEFAULT 'free'
                           CHECK (premium_tier IN ('free', 'standard')),
  keywords               TEXT NOT NULL DEFAULT '[]',
  cpv_codes              TEXT NOT NULL DEFAULT '[]',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  push_token             TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

INSERT INTO users_new
  SELECT id, company_nip, company_name, email, password_hash, premium_tier,
         keywords, cpv_codes, stripe_customer_id, stripe_subscription_id,
         push_token, created_at, updated_at
  FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
