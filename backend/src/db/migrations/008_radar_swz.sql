-- Radar pytań i zmian SWZ (ulepszenie „Radar pytań i odpowiedzi do SWZ",
-- podzadanie 1/7 — model danych). Cztery NOWE, samodzielne tabele:
--   • postepowanie_swz — postępowanie wzięte pod obserwację mechanizmu wyjaśnień
--     SWZ (należy do użytkownika); trzyma termin składania ofert i datę ogłoszenia,
--     z których kolejne podzadanie policzy termin pytań (połowa okna),
--   • swz_wersja       — kolejne wersje treści SWZ (hasz + treść/ścieżka + data),
--   • pytania_swz      — pytania do SWZ (treść, powiązany fragment, status, daty),
--   • zmiany_swz       — zmiany/odpowiedzi zamawiającego (data, opis skutku, diff,
--     powiązane elementy oferty).
--
-- To NOWE tabele, więc dokładamy je wyłącznie `CREATE ... IF NOT EXISTS` — bez
-- ALTER-ów. (Pułapka z pamięci projektu: mieszanie CREATE nowej tabeli z ALTER
-- na bazie nie-świeżej wywala „duplicate column name".) Kolejność CREATE ma
-- znaczenie dla kluczy obcych: tabela-cel musi powstać przed tabelą, która ją
-- referuje (postepowanie_swz → swz_wersja → zmiany_swz).
CREATE TABLE IF NOT EXISTS postepowanie_swz (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nazwa                  TEXT NOT NULL,          -- nazwa/tytuł postępowania (kontekst UI)
  data_ogloszenia        TEXT,                   -- ISO 8601 — data ogłoszenia (baza kalkulatora połowy terminu)
  termin_skladania_ofert TEXT,                   -- ISO 8601 — termin składania ofert (koniec okna monitoringu)
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_postepowanie_swz_user ON postepowanie_swz(user_id);

CREATE TABLE IF NOT EXISTS swz_wersja (
  id              TEXT PRIMARY KEY,
  postepowanie_id TEXT NOT NULL REFERENCES postepowanie_swz(id) ON DELETE CASCADE,
  numer           INTEGER NOT NULL DEFAULT 1,    -- kolejny numer wersji w obrębie postępowania
  hash            TEXT NOT NULL,                 -- hasz treści SWZ (dedup „czy to nowa wersja?")
  tresc           TEXT,                          -- treść SWZ inline (opcjonalna, gdy trzymamy plik)
  sciezka         TEXT,                          -- ścieżka/URL do pliku SWZ (opcjonalna, gdy treść inline)
  data_publikacji TEXT NOT NULL,                 -- ISO 8601 — data publikacji tej wersji przez zamawiającego
  created_at      TEXT NOT NULL,
  UNIQUE (postepowanie_id, hash)                 -- ten sam hasz w tym samym postępowaniu = ta sama wersja
);
CREATE INDEX IF NOT EXISTS idx_swz_wersja_postepowanie ON swz_wersja(postepowanie_id, data_publikacji);

CREATE TABLE IF NOT EXISTS pytania_swz (
  id              TEXT PRIMARY KEY,
  postepowanie_id TEXT NOT NULL REFERENCES postepowanie_swz(id) ON DELETE CASCADE,
  tresc           TEXT NOT NULL,                 -- treść pytania (gotowa do wysłania)
  fragment_swz    TEXT,                          -- powiązany fragment SWZ (cytat/odniesienie)
  status          TEXT NOT NULL DEFAULT 'szkic'
                    CHECK (status IN ('szkic', 'wyslane', 'odpowiedziane')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pytania_swz_postepowanie ON pytania_swz(postepowanie_id, status);

CREATE TABLE IF NOT EXISTS zmiany_swz (
  id              TEXT PRIMARY KEY,
  postepowanie_id TEXT NOT NULL REFERENCES postepowanie_swz(id) ON DELETE CASCADE,
  wersja_swz_id   TEXT REFERENCES swz_wersja(id) ON DELETE SET NULL,  -- wersja, z której wynika zmiana
  data_publikacji TEXT NOT NULL,                 -- ISO 8601 — kiedy zamawiający opublikował zmianę
  opis_skutku     TEXT,                          -- czytelny skutek zmiany (do UI/alertu)
  diff            TEXT,                          -- różnica wobec poprzedniej wersji
  elementy_oferty TEXT NOT NULL DEFAULT '[]',    -- JSON: string[] — sekcje oferty do aktualizacji
  uwzglednione    INTEGER NOT NULL DEFAULT 0,    -- 0 = „wymaga aktualizacji" (bramka), 1 = wykonawca uwzględnił zmianę
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zmiany_swz_postepowanie ON zmiany_swz(postepowanie_id, data_publikacji);
