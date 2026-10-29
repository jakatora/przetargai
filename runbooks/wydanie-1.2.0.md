# Wydanie 1.2.0 (vc22) — 2026-10-29

Zakres: `store/whats-new-1.2.0.md` — nowy wygląd aplikacji (gałąź `feat/design`, scalona do main 28.10,
kierunek w `docs/design-system.md`), automatyczna analiza SWZ dla wybranych przetargów (Standard) i alert
„SWZ przeanalizowana” w Centrum alertów. Serwer już na produkcji (`autoswzfetch-00004`, `api-00070+`),
strona przetarg-ai.pl w nowym wyglądzie od 28.10. Wydanie = sama aplikacja + strona pobierania + `wersja.json`.

Procedura jak w `runbooks/wydanie-1.1.9.md` (hosting z worktree: `firebase/hosting/` = live + `landing/*`
BEZ `landing/v2`, `landing/v3` + `PrzetargAI.apk`; deploy Functions tylko partiami po 2–3 funkcje).

## Przebieg
- [x] Testy po scaleniu origin/main: Functions 1508/1508, mobile 1292/1292 + `npm run check`, backend 1054/1054.
- [x] Wersja: `mobile/app.json` 1.2.0 / versionCode 22; gitignorowany `build.gradle` 22 / "1.2.0"; `desktop/package.json` 1.2.0; `landing/wersja.json` 1.2.0.
- [x] Android: gradle 3 min 7 s → `C:\Users\Startklaar\Documents\PrzetargAI-1.2.0.apk` (67 945 963 B, SHA-256 32ccc2ff…, apksigner CN=PrzetargAI SHA-1 b66e24…, vc22/1.2.0; paczka JS celuje w produkcyjne API) i `PrzetargAI-1.2.0.aab` (46 638 232 B).
- [x] Windows: `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.2.0.exe`, `-przenosna.exe`. PIERWSZY build celował w `http://localhost:8096` (cache Metro z podglądu sesji redesignu z `EXPO_PUBLIC_API_URL`) — smoke mówił „OK” przy ekranie „Brak połączenia z serwerem”. Naprawa: `eksportWeb.js` z `--clear` + strażnik produkcyjnego API, `smoke.js` pada na ekranie błędu. Drugi build: smoke OK z realnymi danymi (raport przeglądu, wybrane przetargi).
- [x] Strona pobierania + hosting 29.10 ~20:10 PL: live „Pobierz APK 1.2.0” (67 945 963 B, suma 32ccc2ff…), `wersja.json` 1.2.0 (baner nowej wersji w apkach 1.1.8+).
- [x] origin/main = `f9564fc`; Codemagic `ios-release` #25 `6ae38925ee3582b3b19646f1` — finished 29.10 18:10 UTC, publishing OK (TestFlight). IPA: 1.2.0 (build 125), paczka JS celuje w produkcyjne API.
- [ ] Sklepy (user): Play Console AAB vc22 + „Informacje o wersji” z `store/whats-new-1.2.0.md`; ASC po TestFlight.
- [x] STAN w pamięci projektu.
