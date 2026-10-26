# Wydanie 1.1.9 (vc21) — 2026-10-26

Zakres: `store/whats-new-1.1.9.md` (SWZ z e-Zamówień prosto do Radaru — serwer dociąga dokumenty po wyborze
dopasowania; nowe źródło e-ProPublico; ogłoszenia bez CPV w selekcji przez nazwy kodów; CORS dla banera nowej
wersji na Windows). Serwer już na produkcji (`api-00064-def`, 26.10 ~19:15 PL). Gałąź `integ/1.1.2` = origin/main
(`a8093c3`, remont z sesji Codex) + nasze commity.

Procedura jak w `runbooks/wydanie-1.1.8.md`. Nowość: hosting wdrażany z worktree (`D:\wt\przetargai-release\firebase`,
gitignorowany `hosting/` = kopia live + `landing/*` + APK), bo główny klon `D:\projekty\przetarg-ai` ma cudzy
niezacommitowany WIP na innej gałęzi.

## Pułapki z tego wydania (patrz pamięć projektu)
- Cloud Run „Quota exceeded for total allowable CPU per project per region" blokował rollout rewizji, a CLI Firebase
  pokazywało potem „Skipped (No changes detected)" → zadania cykliczne mają `maxInstances: 1`; po deployu sprawdzać
  rewizje (`stan_funkcji.cjs`), nie komunikat.
- e-propublico.pl wysyła niepełny łańcuch TLS → `fetchHttps` z cross-certem Root YR (`lib/certyLetsEncrypt.js`).
- Baner „jest nowa wersja" na Windows: `wersja.json` musi mieć CORS (`firebase.json` → headers; test `landingStrona`).

## Przebieg
- [x] Testy po scaleniu origin/main (`a8093c3`): Functions 1493/1493, mobile 1291/1291 (bramka strony pobierania zielona po wgraniu APK), backend 1054/1054.
- [x] Wersja: `mobile/app.json` 1.1.9 / versionCode 21; gitignorowany `build.gradle` 21 / "1.1.9"; `desktop/package.json` 1.1.9 (`156d5a6`); `landing/wersja.json` 1.1.9.
- [x] Functions: `api-00064-def`, `pracownikco3h-00012-rop` (dokumenty e-Zamówień), wcześniej e-ProPublico i sygnał nazw CPV.
- [x] Android: gradle 3 min 38 s → `C:\Users\Startklaar\Documents\PrzetargAI-1.1.9.apk` (67 931 119 B, SHA-256 cd637872…, apksigner: CN=PrzetargAI, SHA-1 b66e24…, vc21/1.1.9) i `PrzetargAI-1.1.9.aab` (46 628 411 B).
- [x] Windows: `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.1.9.exe`, `-przenosna.exe` (smoke OK, 26.10 19:25).
- [x] Strona pobierania + hosting wdrożone z worktree 26.10 ~20:08 PL: live „Pobierz APK 1.1.9” (67 931 119 B), `wersja.json` 1.1.9 z `Access-Control-Allow-Origin: *` (sprawdzone curlem).
- [x] origin/main = `ade56ed`; Codemagic `ios-release` build `6adf988c7896d4618b67a2f3` (start 26.10 ~20:16 PL).
- [ ] Sklepy (user): Play Console AAB vc21 + „Informacje o wersji" z `store/whats-new-1.1.9.md`; ASC po TestFlight.
- [ ] STAN w pamięci projektu.
