-- Historyczne rozstrzygnięcia przetargów (BZP/TED) — model bazy „zwiadu cenowego"
-- (ulepszenie „Cenowy zwiad: za ile realnie wygrywa się takie przetargi",
-- podzadanie 1/15).
--
-- Dla ocenianego przetargu chcemy pokazać TWARDE dane z przeszłości: za ile
-- wygrywano podobne zamówienia (ten sam kod CPV, region NUTS, skala), jaki był
-- rozrzut cen między zwycięzcą a resztą, ile wynosił budżet zamawiającego vs
-- cena zwycięska i kto zwykle startuje/wygrywa u danego zamawiającego. Tu
-- powstaje SAM MODEL na te dane; import (osobne podzadanie) je wypełni.
--
-- To DANE WSPÓLNE (referencyjne) — nie należą do konta użytkownika, więc bez
-- klucza obcego do `users`. Nowa, samodzielna tabela: `CREATE ... IF NOT EXISTS`
-- jest idempotentne i bezpiecznie dokłada ją na działającej produkcji.
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
