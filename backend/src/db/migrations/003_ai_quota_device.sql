-- Dobowy limit płatnych wywołań AI na urządzenie (audyt 2026-07-09/10).
--
-- Trasy `/api/fitter/scan-iso` i `/api/fitter/ai` są NIEUWIERZYTELNIONE, a każde
-- żądanie to realny koszt (skan ISO = wywołanie Sonneta z wizją, ~$0,02).
-- `device_id` to dowolny tekst podany przez klienta, więc jedyną obroną był
-- limiter na adres IP — trywialny do obejścia z wielu adresów.
--
-- Limit dobowy per urządzenie nie odcina darmowych użytkowników (to byłaby zmiana
-- produktowa), ale sprawia, że nadużycie kosztuje atakującego tyle samo pracy,
-- co uczciwe korzystanie.
CREATE TABLE IF NOT EXISTS ai_quota_device (
  device_id  TEXT NOT NULL,
  day        TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  operation  TEXT NOT NULL,          -- 'fitter_scan' | 'fitter_chat'
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, day, operation)
);
CREATE INDEX IF NOT EXISTS idx_ai_quota_device_day ON ai_quota_device(day);
