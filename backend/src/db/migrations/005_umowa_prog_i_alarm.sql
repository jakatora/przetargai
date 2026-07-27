-- Śledzenie waloryzacji W TRAKCIE kontraktu (ulepszenie „pilnowanie waloryzacji
-- i pułapek w umowie", podzadanie 11/12). Do rekordu monitorowanej umowy
-- (migracja 004) dokładamy to, czego potrzebuje ALARM:
--   • prog                    — próg waloryzacji odczytany z umowy (%). Alarm
--                               porównuje z nim wzrost cen. NULL = brak jawnego
--                               progu → rekord nie alarmuje (nie wiemy, co przekroczyć).
--   • wskaznik_aktualny       — ostatnio pobrany z GUS wskaźnik cen (punkt „teraz").
--   • wskaznik_aktualny_okres — okres tego wskaźnika (np. '2026').
--   • alarm_wyslany           — 0/1: czy alarm o przekroczeniu progu już poszedł,
--                               żeby cykliczny job nie powiadamiał w kółko.
--
-- Wszystkie kolumny są opcjonalne / mają wartość domyślną, więc rekordy wzięte
-- pod monitoring przez podzadanie 10 migrują bez utraty danych. SQLite dokłada
-- kolumny ADD COLUMN-em (stała wartość domyślna dla NOT NULL jest dozwolona).
ALTER TABLE umowa_monitorowana ADD COLUMN prog REAL;
ALTER TABLE umowa_monitorowana ADD COLUMN wskaznik_aktualny REAL;
ALTER TABLE umowa_monitorowana ADD COLUMN wskaznik_aktualny_okres TEXT;
ALTER TABLE umowa_monitorowana ADD COLUMN alarm_wyslany INTEGER NOT NULL DEFAULT 0;
