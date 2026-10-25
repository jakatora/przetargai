# Wydanie 1.1.8 (vc20) — 2026-10-25 wieczorem

Zakres: `store/whats-new-1.1.8.md` (baner „jest nowa wersja” dla APK/Windows, Konto i narzędzia po angielsku,
źródło platformazakupowa.pl: szczegół na żądanie, SWZ z załącznika prosto do Radaru). Serwer już na produkcji
(`api-00057-ded`); to wydanie to sama aplikacja + strona pobierania + `wersja.json`.

Procedura jak w `runbooks/wydanie-1.1.7.md`. Nowość: `landing/wersja.json` MUSI mieć wersję apki (test `landingStrona`).

## Przebieg
- [x] Testy przed wydaniem: Functions 1471/1471, mobile 1289/1289, backend 1054/1054.
- [x] Wersja: app.json 1.1.8 / vc 20; gitignorowany build.gradle 20 / "1.1.8"; desktop 1.1.8; `landing/wersja.json` 1.1.8 — commit `aecee11`.
- [x] Android: `Documents\PrzetargAI-1.1.8.aab/.apk` (vc20, CN=PrzetargAI, O=Jakatora; APK 67 927 227 B, SHA-256 b321ad73…).
- [x] Windows: smoke OK → `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.1.8.exe`, `-przenosna.exe`.
- [x] Strona pobierania + hosting wdrożone: live „Pobierz APK 1.1.8”, 67 927 227 B, `wersja.json` = 1.1.8 (baner nowej wersji działa od apek 1.1.8 wzwyż).
- [x] origin/main = `3dd140e`; Codemagic `ios-release` build `6ade43227277c2a5ad48a332` (start 25.10 ~19:05).
- [ ] Sklepy (user): Play Console AAB vc20 + „Informacje o wersji”; ASC po TestFlight.
- [ ] STAN w pamięci projektu.
