-- Treść SWZ WKLEJONA PRZEZ UŻYTKOWNIKA do pierwszej analizy (2026-10-03).
--
-- Do tej pory `POST /postepowania/:id/analiza` oddawało wklejoną SWZ płatnemu AI i jej
-- nie zapisywało. Dopasowanie sejfu do SWZ (a przez nie checklista „co musisz mieć do
-- dnia składania") czytało treść wyłącznie z `swz_wersja`, którą zapisuje tylko
-- `/odswiez` — więc po pierwszej analizie checklista nie znała ŻADNYCH wymagań, a przy
-- awarii albo limicie AI wklejona treść przepadała w całości.
--
-- OSOBNA tabela, a nie wiersz `swz_wersja`, z rozmysłem: `swz_wersja` to wersje
-- OPUBLIKOWANE PRZEZ ZAMAWIAJĄCEGO (`data_publikacji NOT NULL`, baza silnika różnic i
-- wpisów `zmiany_swz`). Treść wklejona do analizy bywa fragmentem albo sklejką rozdziałów;
-- jako „wersja" dostałaby datę publikacji, której nie ma, a kolejna prawdziwa publikacja
-- porównana z nią dałaby fałszywą „opublikowaną zmianę".
--
-- Jeden wiersz na postępowanie (PRIMARY KEY) i zapis `ON CONFLICT DO NOTHING`:
-- pierwsza treść wygrywa, ponowienie i równoległe żądania nie tworzą duplikatów ani
-- niczego nie nadpisują. Nowszą treść podaje się przez `/odswiez` — wersja opublikowana
-- ma pierwszeństwo przed wklejoną (patrz services/trescSwz.js).
--
-- NOWA tabela => wyłącznie `CREATE ... IF NOT EXISTS`, bez ALTER-ów (ten sam kształt
-- jest w schema.sql dla świeżych baz). Nie dotyka żadnej istniejącej tabeli.
--
-- ROLLBACK (down): DROP TABLE IF EXISTS swz_tresc_wklejona;
CREATE TABLE IF NOT EXISTS swz_tresc_wklejona (
  postepowanie_id TEXT PRIMARY KEY REFERENCES postepowanie_swz(id) ON DELETE CASCADE,
  hash            TEXT NOT NULL,                 -- SHA-256 treści (rozpoznanie ponowienia tej samej treści)
  tresc           TEXT NOT NULL,                 -- treść SWZ wklejona przez użytkownika do analizy
  created_at      TEXT NOT NULL                  -- ISO 8601 — kiedy UŻYTKOWNIK ją wkleił (to NIE data publikacji)
);
