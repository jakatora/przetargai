# Wydanie 1.1.7 (vc19) — 2026-10-25

Zakres: `store/whats-new-1.1.7.md` (Karta firmy z NIP + auto-dobór słów/CPV, wejście do karty po rejestracji,
TED teren z miejsca realizacji, „termin” wygasa po przedłużeniu, zamówienia w częściach, pismo jako Word:
e-mail / pakiet / pobranie na web). Gałąź `integ/1.1.2` (= origin/main + remont z sesji Codex).

Procedura jak w `runbooks/wydanie-1.1.6.md` (pułapki: `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\jtmp` dla gradle i emulatora;
`railway up` z korzenia klonu; strony prawne są już w repo — `cp landing/* hosting/` bezpieczne).

## Przebieg
- [x] Testy przed wydaniem: Functions 1451/1451, mobile 1281/1281, backend 1054/1054.
- [x] Wersja: `mobile/app.json` 1.1.7 / versionCode 19; gitignorowany `mobile/android/app/build.gradle` 19 / "1.1.7"; `desktop/package.json` 1.1.7 — commit `0990137`.
- [x] Functions: `firebase deploy --only functions:przetargai:api` → `api-00053-rif` (trasy `/eksport/pismo`, `/eksport/pismo.docx` odpowiadają 401 bez tokenu, CORS expose: Content-Disposition, X-Plik). Railway: bez zmian w tym wydaniu.
- [x] Android: gradle `bundleRelease assembleRelease` → `Documents\PrzetargAI-1.1.7.aab/.apk` (vc19, CN=PrzetargAI, O=Jakatora; APK 67 907 123 B, SHA-256 aaa26fbe…).
- [x] Windows: eksport web + electron-builder, smoke OK → `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.1.7.exe`, `-przenosna.exe`.
- [x] Strona pobierania: `landing/pobierz.html` + test (commit `5c898ec`); hosting wdrożony — live „Pobierz APK 1.1.7”, 67 907 123 B.
- [x] origin/main = `5c898ec`; Codemagic `ios-release` #22 `6addfe191fa8aa2bcd4c12b6` — finished, Publishing success (TestFlight).
- [ ] Sklepy (user): Play Console AAB vc19 + „Informacje o wersji”; ASC po TestFlight; konta recenzji (`play-review@przetargai.demo` free/pusty profil).
- [ ] STAN w pamięci projektu.

## Następne wydanie — pamiętać
- `landing/wersja.json` podbić razem z `app.json` (test `landingStrona` wymusza) i wdrożyć hosting — baner „jest nowa wersja” (APK ze strony / Windows) czyta ten plik.

## Po wydaniu 1.1.7 (25.10 po południu)
- Functions `api-00054-xaq`: nowe źródło platformazakupowa.pl (`pzOknoFetch`, co godz. :35, 2 strony × 100). Pierwszy przebieg ręczny: 200 nowych ogłoszeń, 0 błędów. Ręczne wyzwolenie zaplanowanej funkcji: Cloud Scheduler API `jobs/firebase-schedule-<fn>-europe-central2:run` z poświadczeniami firebase-tools (`apiv2` + `requireAuth`).
