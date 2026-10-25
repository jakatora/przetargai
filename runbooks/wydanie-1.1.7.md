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
- [ ] Android: gradle `bundleRelease assembleRelease` → `Documents\PrzetargAI-1.1.7.aab/.apk` (klucz przesyłania SHA-1 B6:6E:24).
- [ ] Windows: `node skrypty/eksportWeb.js` + `electron-builder --win nsis portable`, smoke → `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.1.7.exe`, `-przenosna.exe`.
- [ ] Strona pobierania: `landing/pobierz.html` (wersja, rozmiar, SHA-256) + `mobile/test/landingStrona.test.js`; `hosting/PrzetargAI.apk` + deploy hostingu.
- [ ] `git push origin integ/1.1.2:main` + Codemagic `ios-release` (appId 6a136b1f4213f9c57af79f5b).
- [ ] Sklepy (user): Play Console AAB vc19 + „Informacje o wersji”; ASC po TestFlight; konta recenzji (`play-review@przetargai.demo` free/pusty profil).
- [ ] STAN w pamięci projektu.
