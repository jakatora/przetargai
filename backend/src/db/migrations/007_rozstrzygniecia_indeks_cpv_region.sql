-- Indeks złożony (kod CPV + region NUTS) dla „zwiadu cenowego"
-- (ulepszenie „Cenowy zwiad: za ile realnie wygrywa się takie przetargi",
-- podzadanie 2/15).
--
-- Rdzeń zwiadu to pytanie „za ile wygrywano PODOBNE zamówienia?", a podobne =
-- ten sam kod CPV w tym samym regionie. Zapytanie
--   WHERE kod_cpv = ? AND region_nuts = ?
-- obsługuje wprost indeks złożony wiodący kodem CPV (kolumna najbardziej
-- selektywna z przodu). Istniejący idx_rozstrz_region(region_nuts) zostaje —
-- służy zapytaniom filtrującym wyłącznie po regionie, których złożony nie pokryje.
--
-- Osobny indeks po ID zamawiającego (idx_rozstrz_zamawiajacy) powstał już w
-- migracji 006 — tu go świadomie NIE dublujemy; dokładamy tylko brakujący
-- indeks złożony. Sam indeks, IF NOT EXISTS — idempotentne i bezpieczne na
-- działającej produkcji (nie dotyka danych ani kształtu tabeli).
CREATE INDEX IF NOT EXISTS idx_rozstrz_cpv_region
  ON rozstrzygniecie_historyczne(kod_cpv, region_nuts);
