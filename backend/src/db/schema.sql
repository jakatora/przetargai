-- PrzetargAI — schemat bazy danych (SQLite). Idempotentny: CREATE ... IF NOT EXISTS.

-- Użytkownicy / firmy. Profil (keywords, cpv_codes) jest niezbędny do matchingu.
-- NIP i nazwa firmy są OPCJONALNE (migracja 001) — persona JDG rejestruje się
-- samym e-mailem; NIP schodzi do momentu wystawienia faktury.
CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  company_nip            TEXT UNIQUE,
  company_name           TEXT,
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

-- Dobowy limit płatnych wywołań AI na urządzenie (migracja 003).
CREATE TABLE IF NOT EXISTS ai_quota_device (
  device_id  TEXT NOT NULL,
  day        TEXT NOT NULL,
  operation  TEXT NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, day, operation)
);
CREATE INDEX IF NOT EXISTS idx_ai_quota_device_day ON ai_quota_device(day);

-- Rejestr obsłużonych zdarzeń Stripe — idempotencja webhooka (migracja 002).
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_events(processed_at);

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

-- Fitter Welder Pro — moduł Praca. 49 PLN za ogłoszenie via Stripe one-time
-- payment. Bez wyjątków — nawet Premium płaci. Listing jest DRAFT do momentu
-- aż webhook potwierdzi płatność, wtedy ustawia is_paid=1 i expires_at +30d.
CREATE TABLE IF NOT EXISTS fitter_job_listing (
  id                 TEXT PRIMARY KEY,
  device_id          TEXT NOT NULL,
  title              TEXT NOT NULL,
  company            TEXT NOT NULL,
  location           TEXT NOT NULL,
  rate               TEXT,
  description        TEXT NOT NULL,
  requirements_csv   TEXT,
  contact_email      TEXT,
  contact_phone      TEXT,
  is_paid            INTEGER NOT NULL DEFAULT 0,
  stripe_session_id  TEXT,
  expires_at         TEXT,                -- ISO 8601, NULL aż do payment
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_paid_created ON fitter_job_listing(is_paid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_device ON fitter_job_listing(device_id);
CREATE INDEX IF NOT EXISTS idx_job_session ON fitter_job_listing(stripe_session_id);

-- Monitoring umowy pod kątem waloryzacji (ulepszenie „pilnowanie waloryzacji i
-- pułapek w umowie", migracje 004 + 005). W chwili podpisania zapisujemy branżę
-- kontraktu (dobór wskaźnika cen GUS), wskaźnik bazowy GUS (punkt odniesienia dla
-- liczenia wzrostu cen) i próg waloryzacji z umowy. W trakcie realizacji cykliczny
-- job (jobs/monitorWaloryzacji.js) dopisuje aktualny wskaźnik i alarmuje po
-- przekroczeniu progu. Rekord należy do użytkownika.
CREATE TABLE IF NOT EXISTS umowa_monitorowana (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branza                  TEXT NOT NULL,          -- branża kontraktu (dobór wskaźnika GUS)
  wskaznik_bazowy         REAL NOT NULL,          -- wskaźnik GUS w chwili podpisania (baza porównania)
  wskaznik_okres          TEXT,                   -- okres GUS bazowego (np. '2026-Q2'); opcjonalny kontekst
  data_podpisania         TEXT NOT NULL,          -- ISO 8601 — moment podpisania (domyślnie chwila zapisu)
  prog                    REAL,                   -- próg waloryzacji z umowy (%); NULL => rekord nie alarmuje
  wskaznik_aktualny       REAL,                   -- ostatnio pobrany wskaźnik GUS (punkt „teraz")
  wskaznik_aktualny_okres TEXT,                   -- okres ostatniego wskaźnika
  alarm_wyslany           INTEGER NOT NULL DEFAULT 0, -- 0/1: czy alarm o przekroczeniu progu już poszedł
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_umowa_monitorowana_user ON umowa_monitorowana(user_id);

-- Historyczne rozstrzygnięcia przetargów (BZP/TED) — baza „zwiadu cenowego"
-- (ulepszenie „Cenowy zwiad: za ile realnie wygrywa się takie przetargi",
-- migracja 006). Dla ocenianego przetargu pokazujemy twarde dane z przeszłości:
-- za ile wygrywano podobne zamówienia (ten sam kod CPV, region NUTS, skala),
-- jaki był rozrzut cen ofert, ile wynosił budżet zamawiającego vs cena zwycięska
-- i kto zwykle wygrywa u danego zamawiającego. To DANE WSPÓLNE (referencyjne) —
-- nie należą do konta użytkownika, więc brak klucza obcego do users. Import
-- (osobne podzadanie) wypełnia rekordy idempotentnie po `external_id`.
CREATE TABLE IF NOT EXISTS rozstrzygniecie_historyczne (
  id                   TEXT PRIMARY KEY,
  external_id          TEXT UNIQUE,                 -- ID ogłoszenia o wyniku (BZP/TED) — dedup przy imporcie
  zrodlo               TEXT NOT NULL DEFAULT 'bzp'
                         CHECK (zrodlo IN ('bzp', 'ted')),   -- z którego rejestru pochodzi rekord
  kod_cpv              TEXT NOT NULL,               -- główny kod CPV (klucz doboru „podobnych" zamówień)
  region_nuts          TEXT,                        -- kod NUTS miejsca realizacji (dobór po regionie)
  zamawiajacy_id       TEXT,                        -- identyfikator zamawiającego (NIP / ID z rejestru)
  zamawiajacy_nazwa    TEXT,                        -- nazwa zamawiającego (kontekst wyświetlania)
  zwyciezca_nazwa      TEXT,                        -- nazwa wykonawcy, który wygrał; NULL gdy unieważnione
  cena_zwycieska       REAL,                        -- cena oferty wygrywającej; NULL gdy unieważnione
  ceny_ofert           TEXT NOT NULL DEFAULT '[]',  -- JSON: number[] — wszystkie ceny ofert (rozrzut)
  budzet_zamawiajacego REAL,                        -- kwota, jaką zamawiający zamierzał przeznaczyć
  wartosc_postepowania REAL,                        -- szacunkowa wartość/skala postępowania (klasyfikacja skali)
  waluta               TEXT NOT NULL DEFAULT 'PLN', -- waluta cen/budżetu (TED bywa w EUR)
  data_rozstrzygniecia TEXT NOT NULL,               -- ISO 8601 — data rozstrzygnięcia lub unieważnienia
  status               TEXT NOT NULL DEFAULT 'rozstrzygniete'
                         CHECK (status IN ('rozstrzygniete', 'uniewaznione')),
  raw_data             TEXT NOT NULL DEFAULT '{}',  -- surowa odpowiedź źródła (audyt / późniejsze parsowanie)
  fetched_at           TEXT NOT NULL                -- moment pobrania rekordu do bazy
);
-- Zwiad cenowy filtruje po CPV (z datą — „ostatnie N rozstrzygnięć"), po regionie
-- i po zamawiającym (kto u niego startuje/wygrywa) — stąd te trzy indeksy.
CREATE INDEX IF NOT EXISTS idx_rozstrz_cpv ON rozstrzygniecie_historyczne(kod_cpv, data_rozstrzygniecia);
CREATE INDEX IF NOT EXISTS idx_rozstrz_zamawiajacy ON rozstrzygniecie_historyczne(zamawiajacy_id);
CREATE INDEX IF NOT EXISTS idx_rozstrz_region ON rozstrzygniecie_historyczne(region_nuts);
-- Dobór „podobnych" rozstrzygnięć: ten sam kod CPV w tym samym regionie
-- (WHERE kod_cpv = ? AND region_nuts = ?) — indeks złożony wiodący CPV (migracja 007).
CREATE INDEX IF NOT EXISTS idx_rozstrz_cpv_region ON rozstrzygniecie_historyczne(kod_cpv, region_nuts);

-- Radar pytań i zmian SWZ (ulepszenie „Radar pytań i odpowiedzi do SWZ",
-- migracja 008). Użytkownik bierze postępowanie pod obserwację mechanizmu
-- wyjaśnień treści SWZ: pilnujemy mało znanego terminu pytań (koniec dnia, w
-- którym upływa POŁOWA terminu składania ofert) oraz monitorujemy publikowane
-- odpowiedzi i kolejne wersje SWZ aż do terminu składania. Rekord należy do
-- użytkownika (jego trzeba ostrzec) — stąd FK do users z kaskadą. Osobne od
-- `tenders` (surowe dane BZP) — to prywatny warsztat przygotowania oferty.
-- `data_ogloszenia` jest tu wcześniej, bo kalkulator terminu pytań (kolejne
-- podzadanie) liczy połowę okna z pary (ogłoszenie, termin składania).
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

-- Kolejne wersje treści SWZ. Monitor publikacji dopisuje nową wersję, gdy zmieni
-- się treść — dedup po `hash` (ten sam hasz = ta sama wersja, nie dublujemy).
-- Trzymamy `tresc` (inline) i/lub `sciezka` (plik/URL); co najmniej jedno z nich.
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

-- Pytania do treści SWZ (wygenerowane lub ręczne). Status prowadzi cykl życia
-- szkic → wysłane → odpowiedziane; `fragment_swz` wiąże pytanie z konkretnym
-- fragmentem dokumentacji, którego dotyczy.
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

-- Zmiany SWZ / odpowiedzi opublikowane przez zamawiającego. Dla każdej: data
-- publikacji, krótki opis skutku (np. „termin realizacji 60→45 dni — przelicz
-- harmonogram i cenę"), diff wobec poprzedniej wersji oraz lista elementów oferty,
-- których dotyczy (JSON string[]: np. harmonogram / cena / parametry). Opcjonalnie
-- wiąże się z konkretną wersją SWZ, z której wynika (silnik różnic uzupełni ją
-- w kolejnym podzadaniu).
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

-- Radar zamówień podprogowych (poniżej 170 tys. zł) — model danych, podzadanie
-- 1/7. Scala zakupy spoza Biuletynu ZP (postępowania wyłączone z Pzp na
-- platformazakupowa.pl / eZamawiający / e-propublico, BIP-y, Baza Konkurencyjności)
-- w jeden strumień obok „dużych" przetargów. Te same `CREATE ... IF NOT EXISTS` co
-- w migracji 009 (bez ALTER — pułapka „duplicate column name"). SQLite bez
-- bool/jsonb: `latwiejszy_start` = INTEGER 0/1, `flagi` = TEXT z JSON-em.
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

-- Sejf dokumentów firmy z licznikiem świeżości (ulepszenie „Sejf podmiotowych
-- środków dowodowych", migracja 010). Podręczny sejf dokumentów firmy: KRK,
-- niezaleganie US/ZUS, polisa OC, wpis do rejestru, wykaz robót/usług,
-- uprawnienia pracowników. Świeżość liczymy z (data_wystawienia +
-- okres_waznosci_dni); status „gotowy / zamów nowy" i alerty (z realnym czasem
-- oczekiwania urzędu) dokładają kolejne podzadania. Elektroniczne zaświadczenia
-- trzymamy w oryginale (XML / podpisany PDF) — `plik_format` + flaga podpisu
-- chronią przed skanem papieru zamiast dokumentu elektronicznego. Rekord należy
-- do użytkownika (FK z kaskadą). Katalog typów (czas urzędu, linki e-KRK/PUE
-- ZUS/e-US) jest w config/dokumentyKatalog.js; `typ_dokumentu` trzyma jego klucz.
-- SQLite bez typu bool: `flaga_podpis_elektroniczny` = INTEGER 0/1.
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
CREATE INDEX IF NOT EXISTS idx_sejf_dokumenty_user ON sejf_dokumenty(user_id, typ_dokumentu);

-- Czarna skrzynka składania oferty (ulepszenie „Czarna skrzynka składania oferty —
-- dowody na awarię platformy", migracja 011). Rejestrator lotu jednej próby złożenia
-- oferty: append-only log zdarzeń ze znacznikiem czasu z zegara serwera + strefą,
-- zrzuty ekranu zapisane w oryginale, suma kontrolna (SHA-256) i oryginał pliku
-- oferty. Dowód musi być NIEZMIENNY (KIO kładzie ciężar udowodnienia awarii na
-- wykonawcę), stąd log bez UPDATE/DELETE. Oba rekordy należą do użytkownika (FK z
-- kaskadą). `postepowanie_id` jest luźnym odniesieniem (bez FK — źródła postępowań
-- są różne). Ten sam kształt jest w migracji 011 — oba idempotentne.
CREATE TABLE IF NOT EXISTS czarna_skrzynka_sesja (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  postepowanie_id  TEXT,                         -- luźne odniesienie do postępowania (BZP/SWZ/podprogowe) — bez FK
  strefa_czasowa   TEXT NOT NULL,                -- strefa zegara serwera w chwili startu (IANA, np. 'Europe/Warsaw')
  hash_oferty      TEXT,                         -- SHA-256 pliku oferty (gdy wgrany) — dowód integralności
  plik_oferty_url  TEXT,                         -- URL/ścieżka ORYGINAŁU oferty zapisanego bez modyfikacji
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_czarna_skrzynka_sesja_user
  ON czarna_skrzynka_sesja(user_id, postepowanie_id);

-- Append-only taśma rejestratora (INTEGER PK AUTOINCREMENT = stabilna kolejność
-- dopisywania). Usługa nie wystawia UPDATE/DELETE — log jest niezmienny.
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

-- Odzyskiwanie hasła — token resetu trzymany WYŁĄCZNIE jako hash SHA-256, jednorazowy i
-- krótko ważny (patrz migracja 012). ON DELETE CASCADE = kasowanie konta usuwa tokeny.
CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
