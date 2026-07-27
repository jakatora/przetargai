-- Czarna skrzynka składania oferty (ulepszenie „Czarna skrzynka składania oferty —
-- dowody na awarię platformy", podzadanie 1/7 — rdzeń rejestratora lotu). Podczas
-- składania oferty przez e-Zamówienia / platformę zakupową aplikacja działa jak
-- rejestrator lotu: prowadzi krok po kroku i UTRWALA DOWODY (zrzuty ze znacznikiem
-- czasu, przebieg sesji, sumę kontrolną pliku oferty, wyniki cyklicznego pingu
-- dostępności). KIO konsekwentnie kładzie ciężar udowodnienia awarii na wykonawcę,
-- więc dowody muszą powstawać NA BIEŻĄCO i być NIEZMIENNE.
--
-- Dwie NOWE, samodzielne tabele należące do użytkownika (FK do users z kaskadą — to
-- jego postępowanie i jego dowody). To NOWE tabele, więc wyłącznie
-- `CREATE ... IF NOT EXISTS`, bez ALTER-ów (pułapka z pamięci projektu: mieszanie
-- CREATE nowej tabeli z ALTER na bazie nie-świeżej wywala „duplicate column name").
-- Ten sam kształt jest w schema.sql (dla świeżych baz) — oba idempotentne.
--
-- ROLLBACK (down):
--   DROP TABLE IF EXISTS czarna_skrzynka_zdarzenie;
--   DROP TABLE IF EXISTS czarna_skrzynka_sesja;

-- Sesja rejestratora lotu — jedna próba złożenia oferty w konkretnym postępowaniu.
-- `postepowanie_id` jest LUŹNYM odniesieniem (bez FK): postępowanie może pochodzić
-- z różnych źródeł (BZP tenders / postepowanie_swz / zamówienia podprogowe), więc
-- nie wiążemy go sztywno. `strefa_czasowa` utrwala strefę zegara SERWERA w chwili
-- startu — dowód czasowy musi mieć jednoznaczną strefę. `hash_oferty` + oryginał
-- pliku (`plik_oferty_url`) to suma kontrolna złożonej oferty.
CREATE TABLE IF NOT EXISTS czarna_skrzynka_sesja (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  postepowanie_id  TEXT,                         -- luźne odniesienie do postępowania (BZP/SWZ/podprogowe) — bez FK, źródła są różne
  strefa_czasowa   TEXT NOT NULL,                -- strefa zegara serwera w chwili startu (IANA, np. 'Europe/Warsaw')
  hash_oferty      TEXT,                         -- SHA-256 pliku oferty (gdy wgrany) — dowód integralności
  plik_oferty_url  TEXT,                         -- URL/ścieżka ORYGINAŁU oferty zapisanego bez modyfikacji
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_czarna_skrzynka_sesja_user
  ON czarna_skrzynka_sesja(user_id, postepowanie_id);

-- Append-only taśma rejestratora: każdy krok / zdarzenie / zrzut / ping ze
-- znacznikiem czasu z zegara SERWERA. INTEGER PK AUTOINCREMENT = naturalna,
-- stabilna kolejność dopisywania (jak fitter_chat_message). Usługa NIE wystawia
-- UPDATE/DELETE na tej tabeli — log jest NIEZMIENNY (dowodu nie wolno „poprawić"
-- po fakcie; to sedno wartości dowodowej przed KIO).
CREATE TABLE IF NOT EXISTS czarna_skrzynka_zdarzenie (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sesja_id       TEXT NOT NULL REFERENCES czarna_skrzynka_sesja(id) ON DELETE CASCADE,
  typ            TEXT NOT NULL,                  -- 'krok'|'blad_wysylki'|'brak_epo'|'niedostepnosc'|'zrzut'|'hash_oferty'|'ping'
  opis           TEXT,                           -- czytelny opis zdarzenia
  plik_url       TEXT,                           -- URL zrzutu/artefaktu (dla typ='zrzut'); NULL dla wpisów tekstowych
  czas_serwera   TEXT NOT NULL,                  -- ISO 8601 (UTC) — znacznik czasu z zegara serwera
  strefa_czasowa TEXT NOT NULL                   -- strefa zegara serwera (IANA) — jednoznaczny „widoczny czas" dowodu
);
CREATE INDEX IF NOT EXISTS idx_czarna_skrzynka_zdarzenie_sesja
  ON czarna_skrzynka_zdarzenie(sesja_id, id);
