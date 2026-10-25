# Wydanie 1.1.6 — runbook (przygotowany 2026-10-24)

Zakres: `integ/1.1.2` (gałąź `feat/robi-za-ciebie`: dokumenty i pisma w 1 klik, SWZ z PDF,
karta decyzji, kalkulator z rynkiem, JEDZ, kalendarz) **+ `feat/pracownik`** (selekcja per klient,
powiadomienia, prowadzenie do wygranej). Wydajemy RAZEM, jednym deployem Functions i jednym Railway.
Teksty sklepowe: `store/whats-new-1.1.6.md`.

## 0. Przed startem
- [x] `feat/pracownik` scalona do `integ/1.1.2` (pracownik scala integ do siebie, potem ff integ).
- [x] `git status` czysty w worktree wydania (`D:\wt\przetargai-release`); cudze niezacommitowane
      `landing/index.html`, `WitajScreen.js`, `profileBranzowe.js` — zdecydować: commit albo stash.
- [x] Pełne testy po scaleniu (nie tylko zespołu — lekcja 2026-09-25):
  - mobile: `cd mobile && npm test && npm run check`
  - backend: `cd backend && npm test` (wymaga `.env.test`)
  - Functions: `cd firebase/functions && JAVA_HOME=~/.jdks/jdk-21.0.12.1+1 JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\jtmp npm test`
    (flaky znany: „pusty profil” radaru planów — zielony osobno).
- [x] `git ls-remote origin main` i `/health` obu backendów — czy nikt nie wdrożył czegoś w międzyczasie.

## 1. Wersja
- [x] `mobile/app.json`: `version` 1.1.6, `android.versionCode` 18.
- [x] `mobile/android/app/build.gradle`: `versionCode 18`, `versionName "1.1.6"` (lokalny build czyta TO, nie app.json).
- [x] Commit „Wydanie 1.1.6 (vc18)”.

## 2. Backend Railway (zmiana: `swz_pdf_base64` w `/api/przetarg/swz/postepowania/:id/analiza` + zmiany pracownika, jeśli są)
- [x] Czysty klon LF: `git clone -c core.autocrlf=false -b integ/1.1.2 D:/wt/przetargai-release <tmp>/klon`
      (CRLF z worktree Windows wywalił migrator 2026-09-25 → przestój wszystkich apek na tym backendzie).
- [x] Smoke lokalnie: `cd klon/backend && npm ci && DATABASE_PATH=<tmp>/s.db PORT=8798 node --env-file=.env.test src/index.js` → `GET /health` 200. Usuń `node_modules` przed uploadem. POMINIĘTE 25.10 (tylko `node --check`); zamiast tego kontrola po deployu.
- [x] Token: `RAILWAY_API_TOKEN` z vaulta (token KONTA; projektowy `RAILWAY_TOKEN` martwy od 24.10).
      `railway link -p <id adventurous-magic> -e production -s backend-przetarg-ai` → `railway up --service backend-przetarg-ai --detach`.
      **Klasyfikator auto-mode blokuje `railway up` — potrzebna zgoda usera w czacie.**
- [x] Ostatni zdrowy deployment do redeployu awaryjnego: `4ce626e9` (24.10, z modułem remont; `8050128e` z 17.10 już REMOVED). Watch: `scratchpad/sledz_deploy.js`. 25.10: zdrowy = nowy deployment z 1d3c9e7 (patrz niżej).
- [x] Po wdrożeniu: `/health` 200, `POST /api/przetarg/swz/postepowania/:id/analiza` z `swz_pdf_base64` → 201 (token usera testowego) — most z Functions 401 bez tokenu. 25.10: `/health` 200 (nowy kontener), `/api/remont/health` 200, `/auth/me` 401, trasa SWZ-PDF odpowiada (nie 404). Deploy: `railway up --ci` z KORZENIA klonu (rootDirectory=backend); pierwsza próba z `backend/` padła „Failed to read app source directory”.

## 3. Cloud Functions (zmiany: `parseScore`, `/health zrodla_cicho_puste`, pracownik)
- [x] Z worktree wydania: `cd firebase && FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions,firestore:indexes --project przetargai`
      Pracownik dodał funkcję `pracownikCo3h` (harmonogram 10 2-23/3, sekrety JWT_SECRET/ANTHROPIC_API_KEY/RESEND_API_KEY — wszystkie już są w Secret Manager, sprawdzone 25.10)
      i 2 indeksy złożone na `evaluations` (decyzja+evaluated_at, decyzja+przyczyna+evaluated_at). Zmienna `PRACOWNIK_ENABLED` ma domyślnie `true` — nic nie ustawiać;
      `false` = wyłącznik awaryjny selekcji (job pomija przebieg, API odpowiada `niedostepne`). Wdrożone dotąd (bez pracownika): aggregateResults api benchmarkPrzelicz bkOknoFetch bzpOknoFetch dailyTenderFetch monitorWyszukiwan planyOknoFetch remindDeadlines weeklyDigest wynikiOknoFetch.
- [x] `/health` → `wersja` = nowa rewizja, `status ok`, sekcja `ai` i `cron.zrodla_cicho_puste` obecne. ZROBIONE 25.10: `api-00051-poq`, 11 funkcji update + `pracownikCo3h` create, indeksy evaluations wgrane.
- [x] Hosting (`przetarg-ai.pl`) tylko jeśli zmieniono landing: deploy z `D:\projekty\przetarg-ai\firebase` (gitignorowany `hosting/`). ZROBIONE 25.10 (APK 1.1.6 + cennik z próbą). UWAGA: `regulamin.html` i `polityka-prywatnosci.html` z danymi firmy są TYLKO w `hosting/` i na live — w repo szablony; nie kopiować ich z `landing/`.

## 4. Buildy
- Android (lokalnie, ~4 min): `cd mobile/android && JAVA_HOME=~/.jdks/jdk-21.0.12.1+1 ANDROID_HOME=~/AppData/Local/Android/sdk JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\jtmp" ./gradlew.bat bundleRelease assembleRelease`
  (bez `JAVA_TOOL_OPTIONS` gradle pada na „Unable to establish loopback connection / Invalid argument: connect” — JDK 21 na Windows robi pipe przez gniazdo unixowe w TEMP; ten sam fix co dla emulatora Firestore, 25.10.2026)
  → `app-release.aab` (podpis B6:6E:24) + APK. **Nie robić `expo prebuild --clean`** (skasuje signingConfig). Kopie do `Documents\PrzetargAI-1.1.6*.{aab,apk}`.
- iOS: push `main` na GitHub (`GITHUB_TOKEN` z vaulta) → `POST api.codemagic.io/builds {appId 6a136b1f4213f9c57af79f5b, workflowId ios-release}` → TestFlight.
  `version` musi być wyższa niż ostatnia zatwierdzona (błąd 90062).
- Windows: `cd desktop && node skrypty/eksportWeb.js && (unset ELECTRON_RUN_AS_NODE; npx electron-builder --win nsis portable)`;
  smoke `node skrypty/smoke.js <exe>` (flaky UnknownVizError → powtórz). Kopie do `D:\projekty\PrzetargAI-Windows`.
- APK na stronę pobierania: `firebase/hosting/PrzetargAI.apk` + SHA-256 + wersja w `pobierz.html` (patrz commit f76261a dla 1.1.5).
  Do tego momentu test `mobile/test/landingStrona.test.js` „wersja APK = wersja aplikacji” jest CZERWONY (1.1.5 ≠ 1.1.6) — to bramka wydania, nie regresja; po wgraniu APK wpisać nową sumę, rozmiar i wersję.

## 5. Sklepy (ręka właściciela)
- [ ] Play Console: AAB vc18 → produkcja; „Informacje o wersji” z `whats-new-1.1.6.md` (bez emoji).
- [ ] App Store Connect: po TestFlight submit do review; „Co nowego” PL/EN.
- [ ] Konta recenzji: ASC demo `apple-review@przetargai.test` nie istnieje (401) — założyć/naprawić przed submitem.

## 6. Po wydaniu
- [x] `git push origin main` (lub integ → main) — `GITHUB_TOKEN` z vaulta. ZROBIONE 25.10: origin/main = 1d3c9e7 (integ + modul remont); Codemagic ios-release build #21 `6addcc154a02b7f35d2acfe3` (IPA OK, publishing).
- [ ] STAN w pamięci projektu: wersja, rewizje Functions, deployment Railway, buildy.
- [ ] Sprzątanie: worktree `D:\wt\przetargai-robi` i `D:\wt\przetargai-pracownik` po scaleniu.
