-- Odzyskiwanie hasła (ulepszenie „profesjonalny fundament apki": reset hasła mailem).
--
-- Token resetu NIGDY nie jest trzymany w plaintext — zapisujemy tylko jego hash SHA-256.
-- Nawet wyciek bazy nie pozwala zresetować cudzego hasła. Token jest jednorazowy
-- (`used_at`) i krótko ważny (`expires_at`, zwykle 1 h). Kasowanie konta (RODO art. 17)
-- usuwa tokeny razem z użytkownikiem — stąd ON DELETE CASCADE.
CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,              -- SHA-256 tokenu wysłanego mailem (nigdy plaintext)
  expires_at  TEXT NOT NULL,              -- ISO 8601 — po tym czasie token nieważny
  used_at     TEXT,                       -- ISO 8601 — ustawiane przy użyciu (jednorazowość)
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
