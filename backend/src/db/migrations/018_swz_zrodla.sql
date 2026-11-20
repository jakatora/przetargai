-- Pochodzenie cytatów i mapa stron zachowane wraz z niezmienną treścią wersji.
ALTER TABLE swz_wersja ADD COLUMN strony TEXT;
ALTER TABLE swz_tresc_wklejona ADD COLUMN sciezka TEXT;
ALTER TABLE pytania_swz ADD COLUMN zrodlo TEXT;
ALTER TABLE zmiany_swz ADD COLUMN porownanie TEXT;
