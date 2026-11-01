# Wydanie 1.2.2 (vc24) — PLAN, start dopiero na „tak” właściciela

Zakres: ekrany i karty dla funkcji serwera z 31.10–1.11 (lista w `store/whats-new-1.2.2.md`). Serwer działa
niezależnie od apki — 1.2.1 w sklepach dostaje już alerty, monitoring, kryteria w danych i „ile dać” na karcie
startu; 1.2.2 dokłada ekrany (kryteria na kartach, „Kto wygrywa”, wygasające umowy, „Zapytaj SWZ” na ekranie
przetargu, „Wypełnij moimi danymi”, kontrola plików, znaczniki zmian, otwarcie ofert, „Wybrana oferta”,
dokumenty e-Zamówień dla TED, NIP w koncie, push `umowa_nastepca` / `nowe_dokumenty` / `wynik_przetargu`).
Procedura jak w `runbooks/wydanie-1.2.0.md` (eksport web z `--clear` + strażnik API, smoke pada na ekranie błędu).

## Przebieg (do odhaczenia przy wydaniu)
- [ ] Testy: Functions (1680+), mobile (1333+) + `npm run check`, backend Railway.
- [ ] Wersja: `mobile/app.json` 1.2.2 / vc24; `android/app/build.gradle` 24 / "1.2.2"; `desktop/package.json` 1.2.2; `landing/wersja.json` 1.2.2.
- [ ] Android: APK + AAB podpisane keystore'em z `cut_list_app_new\upload-keystore.jks` (kopiowany do `android/key.properties`); suma SHA-256 do strony pobierania.
- [ ] Windows: instalator + wersja przenośna, strażnik API, smoke z realnymi danymi.
- [ ] Strona pobierania + hosting: „Pobierz APK 1.2.2”, `wersja.json` 1.2.2.
- [ ] iOS: Codemagic `ios-release` (nigdy lokalnie) → TestFlight.
- [ ] Sklepy (user): Play Console AAB vc24 + teksty `store/whats-new-1.2.2.md`; ASC build 1.2.2 z TestFlight.
- [ ] Po wydaniu: konta zaczynają mieć `company_nip` (1.11: 0/30) — sprawdzić licznik w bazie po tygodniu.
