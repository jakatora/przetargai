-- Sejf dokumentów firmy z licznikiem świeżości (ulepszenie „Sejf podmiotowych
-- środków dowodowych", podzadanie 1/7 — model danych). Podręczny sejf dokumentów
-- firmy: zaświadczenie KRK, niezaleganie US/ZUS, polisa OC, wpis do rejestru,
-- wykaz robót/usług, uprawnienia pracowników. Przy każdym dokumencie liczymy
-- świeżość (data_wystawienia + okres_waznosci_dni) i status „gotowy / zamów nowy".
-- Elektroniczne zaświadczenia trzymamy w ORYGINALNYCH plikach (XML / podpisany
-- PDF), stąd `plik_format` + `flaga_podpis_elektroniczny` — żeby nie wpaść na skan
-- papieru zamiast dokumentu elektronicznego.
--
-- Jedna NOWA, samodzielna tabela należąca do użytkownika (FK do users z kaskadą —
-- to jego dokumenty, więc znikają razem z kontem). Katalog typów wraz z realnym
-- czasem oczekiwania urzędu i linkami online (e-KRK / PUE ZUS / e-Urząd Skarbowy)
-- jest w `backend/src/config/dokumentyKatalog.js` — `typ_dokumentu` trzyma jego
-- klucz (walidacja w warstwie usług, bez sztywnego CHECK-a, żeby dołożenie typu
-- nie wymagało przebudowy tabeli). `plik_format` MA CHECK (stały, mały zbiór).
--
-- To NOWA tabela, więc dokładamy ją wyłącznie `CREATE ... IF NOT EXISTS` — bez
-- ALTER-ów (pułapka z pamięci projektu: mieszanie CREATE nowej tabeli z ALTER na
-- bazie nie-świeżej wywala „duplicate column name"). Ten sam kształt jest w
-- schema.sql (dla świeżych baz) — oba idempotentne, więc się nie kłócą. SQLite bez
-- typu bool: `flaga_podpis_elektroniczny` to INTEGER 0/1.
--
-- ROLLBACK (down): DROP TABLE IF EXISTS sejf_dokumenty;
CREATE TABLE IF NOT EXISTS sejf_dokumenty (
  id                         TEXT PRIMARY KEY,
  user_id                    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  typ_dokumentu              TEXT NOT NULL,               -- klucz z config/dokumentyKatalog.js (krk, us, zus, ...)
  data_wystawienia           TEXT,                        -- ISO 8601 — data wystawienia (baza licznika świeżości)
  okres_waznosci_dni         INTEGER,                     -- ważność w dniach; NULL = bezterminowy (domyślnie z katalogu)
  plik_url                   TEXT,                        -- URL/ścieżka oryginalnego pliku; NULL dopóki brak pliku
  plik_format                TEXT CHECK (plik_format IN ('xml', 'pdf')),  -- format oryginału; NULL dopóki brak pliku
  flaga_podpis_elektroniczny INTEGER NOT NULL DEFAULT 0,  -- 1 = dokument elektroniczny (XML/podpisany PDF); 0 = brak/skan papieru
  notatka                    TEXT,                        -- notatka użytkownika
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);
-- Lista sejfu i dopasowanie do SWZ pytają po właścicielu (i typie) — stąd indeks.
CREATE INDEX IF NOT EXISTS idx_sejf_dokumenty_user ON sejf_dokumenty(user_id, typ_dokumentu);
