# Wydanie 1.1.8 (vc20) — 2026-10-25 wieczorem

Zakres: `store/whats-new-1.1.8.md` (baner „jest nowa wersja” dla APK/Windows, Konto i narzędzia po angielsku,
źródło platformazakupowa.pl: szczegół na żądanie, SWZ z załącznika prosto do Radaru). Serwer już na produkcji
(`api-00057-ded`); to wydanie to sama aplikacja + strona pobierania + `wersja.json`.

Procedura jak w `runbooks/wydanie-1.1.7.md`. Nowość: `landing/wersja.json` MUSI mieć wersję apki (test `landingStrona`).

## Przebieg
- [x] Testy przed wydaniem: Functions 1471/1471, mobile 1289/1289, backend 1054/1054.
- [x] Wersja: app.json 1.1.8 / vc 20; gitignorowany build.gradle 20 / "1.1.8"; desktop 1.1.8; `landing/wersja.json` 1.1.8 — commit `aecee11`.
- [ ] Android: gradle → `Documents\PrzetargAI-1.1.8.aab/.apk`.
- [ ] Windows: eksport web + electron-builder, smoke → `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.1.8.exe`, `-przenosna.exe`.
- [ ] Strona pobierania: `landing/pobierz.html` + test; hosting: `PrzetargAI.apk`, `pobierz.html`, `wersja.json` (od tego momentu apki 1.1.7 z banerem… nie mają go jeszcze — baner pojawi się od 1.1.8 wzwyż przy kolejnych wydaniach).
- [ ] `git push origin integ/1.1.2:main` + Codemagic `ios-release`.
- [ ] Sklepy (user): Play Console AAB vc20 + „Informacje o wersji”; ASC po TestFlight.
- [ ] STAN w pamięci projektu.
