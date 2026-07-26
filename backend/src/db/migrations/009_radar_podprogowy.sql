-- Radar zamówień podprogowych (ulepszenie „Radar zamówień podprogowych — poniżej
-- 170 tys. zł", podzadanie 1/7 — model danych). Agregujemy zakupy, których NIE ma
-- w Biuletynie Zamówień Publicznych: postępowania wyłączone z Pzp na platformach
-- zakupowych (platformazakupowa.pl, eZamawiający), e-propublico, ogłoszenia z
-- BIP-ów gmin/szpitali/spółek oraz Bazę Konkurencyjności (zasada konkurencyjności
-- od 80 tys. zł). Dwie NOWE, samodzielne tabele:
--   • zamowienia_podprogowe           — scalony strumień znalezisk (jeden rekord =
--     jedno ogłoszenie z dowolnego źródła), z dedupem po `hash_dedup`,
--   • preferencje_radaru_podprogowego — ustawienia użytkownika (branża/region/próg),
--     po których monitor uruchomi adaptery źródeł (kolejne podzadania).
--
-- To NOWE tabele, więc dokładamy je wyłącznie `CREATE ... IF NOT EXISTS` — bez
-- ALTER-ów (pułapka z pamięci projektu: mieszanie CREATE nowej tabeli z ALTER na
-- bazie nie-świeżej wywala „duplicate column name"). Ten sam kształt jest w
-- schema.sql (dla świeżych baz) — oba idempotentne, więc się nie kłócą.
--
-- SQLite nie ma typów bool/jsonb: `latwiejszy_start` to INTEGER 0/1, a `flagi` to
-- TEXT z JSON-em (konwencja repo, jak `elementy_oferty` w zmiany_swz).
--
-- ROLLBACK (down): DROP TABLE IF EXISTS preferencje_radaru_podprogowego;
--                  DROP TABLE IF EXISTS zamowienia_podprogowe;
CREATE TABLE IF NOT EXISTS zamowienia_podprogowe (
  id                     TEXT PRIMARY KEY,
  zrodlo                 TEXT NOT NULL
                           CHECK (zrodlo IN ('bzp_wylaczone', 'platformazakupowa',
                             'ezamawiajacy', 'epropublico', 'baza_konkurencyjnosci', 'bip')),
  id_zewnetrzny          TEXT,                        -- identyfikator ogłoszenia u źródła (o ile jest)
  tytul                  TEXT NOT NULL,               -- tytuł/przedmiot zamówienia
  zamawiajacy            TEXT,                        -- nazwa zamawiającego (gmina/szpital/spółka)
  branza                 TEXT,                        -- dopasowana branża użytkownika
  region                 TEXT,                        -- region/województwo
  wartosc_netto          REAL,                        -- szacowana wartość netto (filtr progu)
  waluta                 TEXT NOT NULL DEFAULT 'PLN',
  termin_skladania       TEXT,                        -- ISO 8601 — termin składania ofert
  link                   TEXT,                        -- URL do ogłoszenia
  regulamin_url          TEXT,                        -- URL regulaminu zakupowego zamawiającego (z BIP)
  regulamin_streszczenie TEXT,                        -- krótkie streszczenie mini-procedury (uzupełni AI)
  latwiejszy_start       INTEGER NOT NULL DEFAULT 0,  -- 1 = „łatwiejszy start" (bez wadium/KIO, prosta procedura)
  flagi                  TEXT NOT NULL DEFAULT '{}',  -- JSON (jsonb): {bez_wadium, bez_kio, prosta_procedura}
  data_publikacji        TEXT,                        -- ISO 8601 — data publikacji ogłoszenia
  hash_dedup             TEXT NOT NULL UNIQUE,        -- odcisk ogłoszenia (dedup między źródłami/odświeżeniami)
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zam_podprog_branza_region
  ON zamowienia_podprogowe(branza, region);
CREATE INDEX IF NOT EXISTS idx_zam_podprog_publikacja
  ON zamowienia_podprogowe(data_publikacji);

-- Preferencje radaru: użytkownik ustawia branżę i region raz, a monitor dla KAŻDEJ
-- zapisanej preferencji uruchamia adaptery. Rekord należy do użytkownika (FK z
-- kaskadą). `prog_netto` domyślnie 170 000 zł (stan progu od 1.01.2026); dla
-- źródła Bazy Konkurencyjności logika (kolejne podzadanie) użyje reguły od 80 tys.
CREATE TABLE IF NOT EXISTS preferencje_radaru_podprogowego (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branza     TEXT,                              -- branża do monitorowania
  region     TEXT,                              -- region do monitorowania
  prog_netto REAL NOT NULL DEFAULT 170000,      -- górny próg wartości netto (domyślnie 170 tys. zł)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, branza, region)              -- jedna preferencja na parę branża/region użytkownika
);
CREATE INDEX IF NOT EXISTS idx_pref_radar_podprog_user
  ON preferencje_radaru_podprogowego(user_id);
