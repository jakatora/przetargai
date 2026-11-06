-- Spoina — aplikacja firmy spawalniczej (kadry, budowy, delegowanie ekip, sprzęt).
-- Osobny zestaw tabel `spoina_*` na wspólnym backendzie; nie dotyka tabel innych aplikacji.
--
-- Model: każda firma ma zbiór dokumentów „kolekcja/id" (pracownik, budowa, wpis godzin…).
-- Aplikacja wysyła zmiany pojedynczych pól, serwer pilnuje uprawnień ról i nadaje każdej
-- zmianie rosnący numer `rev` w obrębie firmy — po nim urządzenia dociągają to, co je ominęło.

CREATE TABLE IF NOT EXISTS spoina_companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  rev             INTEGER NOT NULL DEFAULT 0,   -- numer ostatniej zmiany w firmie
  fixed_code_hash TEXT,                         -- stały kod logowania (firma pokazowa / pilotaż bez SMS); NULL = tylko SMS
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spoina_docs (
  company_id TEXT NOT NULL REFERENCES spoina_companies(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,                     -- 'kolekcja/id'
  json       TEXT,                              -- NULL = dokument usunięty (ślad dla synchronizacji)
  rev        INTEGER NOT NULL,
  updated_by TEXT,                              -- id pracownika, który zrobił zmianę
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, key)
);
CREATE INDEX IF NOT EXISTS idx_spoina_docs_rev ON spoina_docs(company_id, rev);

-- Indeks logowania: numer telefonu → osoba w firmie. Utrzymywany przez serwer przy każdym
-- zapisie dokumentu `workers/<id>`; rola jest czytana stąd przy KAŻDYM żądaniu.
CREATE TABLE IF NOT EXISTS spoina_members (
  company_id TEXT NOT NULL REFERENCES spoina_companies(id) ON DELETE CASCADE,
  worker_id  TEXT NOT NULL,
  phone      TEXT NOT NULL,                     -- same cyfry z kierunkowym, np. 48601204118
  role       TEXT NOT NULL,                     -- 'office'|'toolroom'|'foreman'|'worker'
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_spoina_members_phone ON spoina_members(phone);

-- Jednorazowe kody logowania. Kod trzymany wyłącznie jako skrót HMAC; licznik prób i wysyłek
-- ogranicza zgadywanie i koszt SMS-ów.
CREATE TABLE IF NOT EXISTS spoina_login_codes (
  phone        TEXT PRIMARY KEY,
  code_hash    TEXT,
  expires_at   TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,      -- błędne próby od ostatniego kodu
  locked_until TEXT,                            -- blokada po serii błędnych prób
  sent_at      TEXT,                            -- ostatnia wysyłka
  sent_count   INTEGER NOT NULL DEFAULT 0,      -- wysyłki w bieżącym oknie
  window_start TEXT
);

-- Sesje urządzeń. Token znany tylko urządzeniu; w bazie jego skrót SHA-256.
CREATE TABLE IF NOT EXISTS spoina_sessions (
  token_hash   TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES spoina_companies(id) ON DELETE CASCADE,
  worker_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spoina_sessions_member ON spoina_sessions(company_id, worker_id);

-- Zdjęcia wgrane z telefonu (karta godzin podpisana na budowie). Treść pliku leży na
-- wolumenie obok bazy; tu tylko metryka i właściciel, po którym serwer pilnuje dostępu.
CREATE TABLE IF NOT EXISTS spoina_files (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES spoina_companies(id) ON DELETE CASCADE,
  owner_id   TEXT NOT NULL,                     -- id pracownika, który wgrał plik
  mime       TEXT NOT NULL,                     -- 'image/jpeg'|'image/png'|'image/webp'
  bytes      INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spoina_files_company ON spoina_files(company_id);
