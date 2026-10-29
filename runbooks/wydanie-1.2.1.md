# Wydanie 1.2.1 (vc23) — 2026-10-29

Zakres: 1.2.0 + aplikacja wysyła platformę urządzenia przy rejestracji push (`AuthContext` → `Platform.OS`;
serwer `push_platform`, `/health.push.urzadzenia` — od `api-00072-fod`). Do sklepów trafia 1.2.1 ZAMIAST 1.2.0
(decyzja usera 29.10) — teksty `store/whats-new-1.2.1.md` opisują całą zmianę względem 1.1.9.
Procedura jak w `runbooks/wydanie-1.2.0.md` (eksport web z `--clear` + strażnik API, smoke pada na ekranie błędu).

## Przebieg
- [x] Testy: Functions 1513/1513 (kod bez zmian od ostatniego przebiegu), mobile 1292/1292 + `npm run check`, backend 1054/1054.
- [x] Wersja: `mobile/app.json` 1.2.1 / vc23; `build.gradle` 23 / "1.2.1"; `desktop/package.json` 1.2.1; `landing/wersja.json` 1.2.1.
- [x] Android: `C:\Users\Startklaar\Documents\PrzetargAI-1.2.1.apk` (67 946 019 B, SHA-256 8f9c9279…, CN=PrzetargAI SHA-1 b66e24…, vc23/1.2.1, paczka celuje w produkcyjne API) i `PrzetargAI-1.2.1.aab` (46 638 272 B).
- [x] Windows: `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.2.1.exe`, `-przenosna.exe`; strażnik API OK, smoke z realnymi danymi.
- [x] Strona pobierania + hosting 29.10 ~20:35 PL: live „Pobierz APK 1.2.1” (suma 8f9c9279…), `wersja.json` 1.2.1.
- [x] origin/main = `5c31dd8`; Codemagic `ios-release` #26 `6ae39f63dd9ce50b4c7429f5` — finished 19:37 UTC, publishing OK (TestFlight); IPA 1.2.1 (build 126) celuje w produkcyjne API i wysyła platformę push.
- [ ] Sklepy (user): Play Console AAB vc23 + teksty `store/whats-new-1.2.1.md`; ASC build 1.2.1 z TestFlight.
- [ ] Po wydaniu: `/health.push.urzadzenia.ios > 0` i `push.ok: true` = push na iPhone potwierdzony.
