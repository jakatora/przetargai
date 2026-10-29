# Wydanie 1.2.0 (vc22) — 2026-10-29

Zakres: `store/whats-new-1.2.0.md` — nowy wygląd aplikacji (gałąź `feat/design`, scalona do main 28.10,
kierunek w `docs/design-system.md`), automatyczna analiza SWZ dla wybranych przetargów (Standard) i alert
„SWZ przeanalizowana” w Centrum alertów. Serwer już na produkcji (`autoswzfetch-00004`, `api-00070+`),
strona przetarg-ai.pl w nowym wyglądzie od 28.10. Wydanie = sama aplikacja + strona pobierania + `wersja.json`.

Procedura jak w `runbooks/wydanie-1.1.9.md` (hosting z worktree: `firebase/hosting/` = live + `landing/*`
BEZ `landing/v2`, `landing/v3` + `PrzetargAI.apk`; deploy Functions tylko partiami po 2–3 funkcje).

## Przebieg
- [ ] Testy po scaleniu origin/main: Functions, mobile, backend.
- [x] Wersja: `mobile/app.json` 1.2.0 / versionCode 22; gitignorowany `build.gradle` 22 / "1.2.0"; `desktop/package.json` 1.2.0; `landing/wersja.json` 1.2.0.
- [ ] Android: gradle `bundleRelease assembleRelease` → `Documents\PrzetargAI-1.2.0.apk/.aab` (vc22, podpis B6:6E:24).
- [ ] Windows: `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.2.0.exe`, `-przenosna.exe` (smoke).
- [ ] Strona pobierania: `landing/pobierz.html` (APK 1.2.0, rozmiar, SHA-256) + test; hosting.
- [ ] origin/main; Codemagic `ios-release` (TestFlight).
- [ ] Sklepy (user): Play Console AAB vc22 + „Informacje o wersji” z `store/whats-new-1.2.0.md`; ASC po TestFlight.
- [ ] STAN w pamięci projektu.
