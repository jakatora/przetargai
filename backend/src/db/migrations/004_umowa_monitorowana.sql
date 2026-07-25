-- Monitoring umowy pod kątem waloryzacji (ulepszenie „pilnowanie waloryzacji i
-- pułapek w umowie", podzadanie 10/12).
--
-- W momencie podpisania umowy zapisujemy dwa fakty, które są bazą całego
-- późniejszego pilnowania waloryzacji: BRANŻĘ kontraktu (po niej dobierany jest
-- właściwy wskaźnik cen GUS) oraz WSKAŹNIK BAZOWY GUS z chwili podpisania (punkt
-- odniesienia — wzrost cen liczymy jako stosunek późniejszego wskaźnika do bazy).
-- Kolejne podzadania (śledzenie wskaźników, alarm po przekroczeniu progu, wniosek
-- o waloryzację) czytają ten rekord.
--
-- Rekord należy do użytkownika (to jego trzeba będzie zaalarmować), a kasowanie
-- konta (RODO art. 17) usuwa monitoring razem z nim — stąd ON DELETE CASCADE.
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
