# Wydanie 1.2.1 (vc23) — 2026-10-29

Zakres: 1.2.0 + aplikacja wysyła platformę urządzenia przy rejestracji push (`AuthContext` → `Platform.OS`;
serwer `push_platform`, `/health.push.urzadzenia` — od `api-00072-fod`). Do sklepów trafia 1.2.1 ZAMIAST 1.2.0
(decyzja usera 29.10) — teksty `store/whats-new-1.2.1.md` opisują całą zmianę względem 1.1.9.
Procedura jak w `runbooks/wydanie-1.2.0.md` (eksport web z `--clear` + strażnik API, smoke pada na ekranie błędu).

## Przebieg
- [x] Testy: Functions 1513/1513 (kod bez zmian od ostatniego przebiegu), mobile 1292/1292 + `npm run check`, backend 1054/1054.
- [x] Wersja: `mobile/app.json` 1.2.1 / vc23; `build.gradle` 23 / "1.2.1"; `desktop/package.json` 1.2.1; `landing/wersja.json` 1.2.1.
- [ ] Android: `Documents\PrzetargAI-1.2.1.apk/.aab`.
- [ ] Windows: `D:\projekty\PrzetargAI-Windows\PrzetargAI-Setup-1.2.1.exe`, `-przenosna.exe` (smoke).
- [ ] Strona pobierania + hosting.
- [ ] origin/main; Codemagic `ios-release` (TestFlight); weryfikacja IPA.
- [ ] Sklepy (user): Play Console AAB vc23 + teksty `store/whats-new-1.2.1.md`; ASC build 1.2.1 z TestFlight.
- [ ] Po wydaniu: `/health.push.urzadzenia.ios > 0` i `push.ok: true` = push na iPhone potwierdzony.
