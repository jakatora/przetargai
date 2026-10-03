# Wydanie 1.1.5 (vc17) — przygotowanie (2026-10-03)

Worktree `D:/wt/przetargai-release`, gałąź `integ/1.1.2`, baza `6ccae33` (= `origin/main`).
Stan: **zacommitowane i wypchnięte wyłącznie na `integ/1.1.2`.** Bez scalania, bez force-push,
bez `main`, bez deployów i bez uruchamiania buildów z mojej strony. Pamięć i inne worktree nietknięte.

**Aktualizacja statusu (2026-10-03, po odbiorze koordynatora):**

| Element | Status |
|---|---|
| Push `integ/1.1.2` | potwierdzony przez koordynatora: zdalna gałąź = `1195227cd676d16215d738d2f8c8fa32d2a1cc2e` |
| Backend (Railway) | wdrożony przez koordynatora — deployment `50dad33d-d1d9-444a-8c22-15922009a490` SUCCESS, migracja 015 zastosowana; w tej i następnej rundzie nieedytowany |
| Strona | **opublikowana przez koordynatora** — Firebase Hosting, wersja `3cb38c164f0b3a4d` |
| iOS | build Codemagic `6ac101f633554ecbc2352716` uruchomiony przez koordynatora z SHA `1195227`; workflow `ios-release` i podpis bez zmian |
| CI Android (`android-release`) | **naprawione** w kolejnym commicie (sekcja 3) — build nieuruchamiany |

## 1. Commity

| SHA | Zakres |
|---|---|
| `b4535231f0bacc886f2ffe660e7adbf566158794` | Backend: pierwsza wklejona SWZ trwale dostępna do dopasowania dokumentów (migracja 015) + testy. To kod wdrożony już na Railway (deployment `50dad33d-…`) — w tej rundzie **nieedytowany**. |
| `86053242d112595113691da47e08ae96198e9803` | Test cen SmartSpiżarki bez pułapki czasowej (wyłącznie plik testu). |
| `2aca56c6b4463d16a4b21cdc7343d9fbb72c6083` | Aplikacja: ścieżka → Radar SWZ → powiązanie → checklista + testy + izolowany test UI. |
| `58211fcac1257628df0843d4f753867ff17b803c` | Strona: źródła zrównane z produkcją, sekcja pierwszej oferty, domena `web.app`, sitemap/robots + test. |
| `a60eed60cbe4fc483ffefe54dc4ae610c39d396b` | Wydanie 1.1.5: numer wersji, teksty wydania, raporty rund 1–2. |
| `1195227cd676d16215d738d2f8c8fa32d2a1cc2e` | Ten raport (pierwsza wersja). Z tego SHA koordynator uruchomił build iOS. |
| (kolejny commit) | Naprawa kroku „Numer wersji" w `android-release` + aktualizacja tego raportu — SHA w odpowiedzi koordynatorowi. |

W commitach nie ma sekretów, plików `.env`, `firebase/hosting/` ani katalogu `mobile/android/`
(oba poza repo). Diff i nowe pliki przeskanowane pod kątem kluczy.

## 2. Punkty odbioru

### 2.1 Powiązanie analizy z przetargiem — bez fałszywej porażki

Błąd żądania nie znaczy, że nic się nie zapisało: odpowiedź mogła zaginąć po zapisie.

- `mobile/src/lib/radarSwz.js`: nowe `powiazIPotwierdz`, `sprawdzPowiazanie`, `odczytanePowiazanie`.
  Po każdej próbie bez potwierdzenia (wyjątek albo odpowiedź, która nie oddaje tej analizy)
  aplikacja **odczytuje stan z serwera**. Jeśli odczyt potwierdza tę analizę → stan OK.
- `opisPowiazania` przy błędzie mówi tyle, ile wie:
  - skutek nieznany → „Nie mamy potwierdzenia… Powiązanie mogło się zapisać mimo błędu — sprawdź je albo ponów";
    przyciski „Sprawdź powiązanie" (sam odczyt) i „Ponów powiązanie";
  - serwer potwierdził brak powiązania → dopiero wtedy „powiązanie się nie zapisało";
  - serwer potwierdził inną analizę → ostrzeżenie z możliwością przepięcia.
  Zdanie „checklista jeszcze jej nie widzi" usunięte.
- `mobile/src/screens/RadarSwzScreen.js`: ekran nie orzeka o wyniku sam — przyjmuje wynik funkcji.
- Testy (`mobile/test/radarSwzPowiazanie.test.js`, 28): utrata odpowiedzi po zapisie, mylący wynik
  (200 bez rekordu, 200 z inną analizą, nieczytelne ciało), błąd zapisu i odczytu naraz,
  odczyt potwierdzający brak, „Sprawdź" bez ponownego zapisu, teksty karty dla każdego stanu.

### 2.2 Zastany czerwony test backendu

`backend/test/smartspizarkaPricesVerifiedOffer.test.js` (a3) wymagał `currency === 'PLN'` na żywej
odpowiedzi, czyli na zegarze serwera; oferta w seedzie wygasła 2026-09-30. Zmiana **wyłącznie w teście**:

- zostaje `body == builder(rekord)` i kontrakt 8 pól,
- aktywna cena (PLN, ilość, kwota) dowiedziona na `TERAZ_W_OKNIE`,
- wygasła cena (piątka money = null) na `TERAZ_PO_WYGASNIECIU`,
- żywa odpowiedź musi być dokładnie jednym z tych dwóch stanów.

Seedy i logika cen nietknięte. Sprawdzone na dwóch zegarach: dzisiejszym (po terminie) i z
zegarem systemowym przesuniętym na 2026-08-20 (w oknie) — 7/7 w obu.

## 3. Wersja i CI

| Miejsce | Było | Jest |
|---|---|---|
| `mobile/app.json` → `expo.version` | 1.1.4 | **1.1.5** |
| `mobile/app.json` → `android.versionCode` | 16 | **17** |
| `desktop/package.json` → `version` | 1.1.4 | **1.1.5** |
| `mobile/android/app/build.gradle` (lokalny, poza repo) | 16 / 1.1.4 | **17 / 1.1.5** |
| `mobile/app.json` → `ios.buildNumber` | 1 | bez zmian (nadpisuje go CI) |

`codemagic.yaml` — workflow `ios-release` **bez zmian**; w `android-release` zmieniony wyłącznie krok
„Numer wersji". Przed edycją przeczytany skill `codemagic-ios-expo` (dotyczy iOS: podpis, prebuild,
CocoaPods — nie zawiera zaleceń dla kroku Androida, więc niczego z niego nie przenoszono):

- **`ios-release`**: wersję marketingową bierze z `app.json` przez `expo prebuild` → 1.1.5.
  Numer builda ustawia krok „Numer builda": `agvtool new-version -all $(($BUILD_NUMBER + 100))`.
  Ostatni build miał indeks 19, więc — jeśli `BUILD_NUMBER` Codemagic odpowiada temu indeksowi —
  następny dostanie numer 120 (rosnący względem poprzedniego). Podpis (grupa `ios_signing`,
  `fetch-signing-files --create`) i grupa `produkcja` z `EXPO_PUBLIC_API_URL` bez zmian.
  1.1.5 > 1.1.4 (TestFlight) > 1.1.0 (publiczny App Store) — wersja rośnie.
- **`android-release`** — **naprawiony** (commit po `1195227`; build nieuruchamiany).
  - Usterka: krok „Numer wersji" robił `sed "s/versionCode 1$/…/"`, a `expo prebuild` wpisuje do
    `build.gradle` wartość z `app.json` (`@expo/config-plugins/build/android/Version.js:84`), dziś
    `versionCode 17`. Wzorzec nie trafiał, podmiana była no-opem, a `grep` po niej kończył krok
    błędem (odtworzone na kopii prawdziwego `build.gradle`: `grep` zwraca 1).
  - Naprawa: krok woła `node scripts/set-android-version-code.mjs` (nowy plik w `mobile/scripts/`,
    obok skryptu podpisu). Skrypt dopasowuje **dowolną całkowitą** wartość `versionCode`, ustawia
    `BUILD_NUMBER + 100` (rośnie z każdym buildem, jak numer builda iOS), zapisuje i sprawdza
    plik na dysku.
  - Jawny błąd (kod wyjścia 1, plik nietknięty) przy: braku `build.gradle`, braku wpisu
    `versionCode`, więcej niż jednym wpisie, wartości nieliczbowej, braku lub złym
    `BUILD_NUMBER`, przekroczeniu limitu Google Play oraz gdy nowy kod **nie jest większy** od
    wartości z `app.json`.
  - Bez zmian: `android_signing: przetargai_keystore`, grupy `google_credentials` i `produkcja`,
    krok podpisu, `bundleRelease`, publikacja (`track: internal`, `submit_as_draft: true`).
    Workflow `ios-release` nietknięty.
  - Sprawdzenie: `mobile/test/androidVersionCode.test.js` — **17/17 PASS** (wartość 1 i 17,
    odstępy, CRLF, komentarz i podobna nazwa, wszystkie błędy, skrypt uruchomiony jak w CI,
    asercje na `codemagic.yaml` dla Androida i iOS). Dodatkowo na kopiach prawdziwego
    `mobile/android/app/build.gradle`: `17 → 120` i `1 → 120` przy `BUILD_NUMBER=20`, zmienia się
    wyłącznie linia `versionCode`; uruchomienie z katalogu `mobile/` z domyślną ścieżką: `17 → 121`.
    `codemagic.yaml` parsuje się poprawnie (PyYAML), a jego diff obejmuje tylko ten krok.
  - **Uwaga operacyjna:** pierwszy AAB z CI dostanie `versionCode` ≥ 101. Po wgraniu go do Google
    Play build lokalny z `versionCode 17`/`18` zostanie odrzucony jako niższy — po przejściu na CI
    trzeba przy nim zostać albo podnieść `android.versionCode` ponad ostatni kod z CI.
  - Niezweryfikowane: faktyczny przebieg workflow na Codemagic (wartość `BUILD_NUMBER` dla
    `android-release`, podpis, upload) — build uruchomi koordynator.

`mobile/package-lock.json` bez zmian — `npm ci` w CI zachowuje się jak przy 1.1.4.

## 4. Wyniki

| Sprawdzenie | Wynik |
|---|---|
| `backend`: `npm test` | **PASS — 1044/1044** (pierwszy raz w tej sesji bez zastanego błędu) |
| `mobile`: `npm test` | **PASS — 1140/1140** (stan z `1195227`; po naprawie CI Androida pełny zestaw nie był powtarzany — kod aplikacji bez zmian, nowy plik testów 17/17 PASS) |
| `mobile`: `npm run check` (esbuild) | **PASS** — kod 0 |
| Kompilacja Metro: `expo export --platform web --clear` dla 1.1.5 | **PASS** — bundel 1,58 MB; z domyślną konfiguracją zawiera wyłącznie produkcyjny endpoint Cloud Functions |
| Izolowany test UI (`mobile/scripts/ui-sciezka-swz.mjs`), 3 scenariusze | **PASS 3/3** — 38 żądań do lokalnej atrapy, 0 tras bez atrapy, **0 żądań poza 127.0.0.1** |
| Test cen na zegarze w oknie i po terminie | PASS 7/7 w obu |
| `firebase/functions` | kod bez zmian w tej rundzie; nieuruchamiane |
| Build iOS (Codemagic) | uruchomiony przez koordynatora (`6ac101f633554ecbc2352716`, SHA `1195227`); wynik — poza tym raportem |
| AAB/APK, instalator Windows, workflow `android-release` | **NIEURUCHAMIANE** — z polecenia |
| Prawdziwe urządzenie (Android/iOS) | **NIEZWERYFIKOWANE** — brak urządzenia w tej sesji |
| Produkcja po wdrożeniu backendu | zweryfikowana przez koordynatora (health, migracja 015); przeze mnie nie |

### Izolowany test UI — co sprawdza i czego nie

Eksport webowy aplikacji uruchomiony w Chrome (headless) na lokalnej atrapie API. Atrapa składa
odpowiedzi z prawdziwych, czystych funkcji backendu i Functions (`bramkaOferty`, `terminPytanSwz`,
`checklistaOferty`, `kalendarzPrzetargu`). Skrypt odmawia pracy, jeśli bundel zawiera adres inny
niż atrapa, i blokuje każde żądanie poza `127.0.0.1`.

1. Szczegóły → „Krok po kroku": karta „Następny krok", odhaczanie przesuwa następne działanie,
   brak komunikatu o komplecie; „Otwórz narzędzie" → Radar z nazwą i terminem z przetargu.
2. Katalog narzędzi → Radar: pusty formularz, brak karty powiązania, zero pytań o powiązanie.
3. Szczegóły → checklista → „Dodaj SWZ w Radarze" → „Dodaj do radaru"; zapis powiązania zwraca 502
   **po zapisaniu** i odczyt też pada → karta „Nie mamy potwierdzenia"; „Sprawdź powiązanie"
   → „jest powiązana" bez drugiego zapisu; wklejenie SWZ przy AI 503 → błąd jawny i „Treść SWZ
   jest zapisana"; checklista pokazuje 2 wykryte dokumenty, „Masz (1)", „Brakuje (1)" i dopisek
   o niepełnej liście.

To test logiki ekranów w `react-native-web`, nie test na urządzeniu: nie sprawdza wyglądu natywnego,
klawiatury, gestów, SecureStore ani powiadomień.

## 5. Ustalenia i ograniczenia

1. **Feed dopasowań nie podaje daty ogłoszenia.** `publicMatch` (Functions) nie ma `published_at`,
   więc Radar otwarty z dopasowania wypełnia nazwę i termin składania, a „Data ogłoszenia" zostaje
   pusta. Wymaga zmiany w Functions — poza zakresem tej rundy.
2. **Pułapka pamięci podręcznej Metro.** Zmienne `EXPO_PUBLIC_*` nie wchodzą do klucza cache:
   pierwszy eksport z adresem atrapy wkleił adres produkcyjny z wcześniejszego buildu (wykryte
   przed uruchomieniem przeglądarki). Test UI wymaga `--clear`; po teście odtworzyłem cache
   eksportem `--clear` bez zmiennej i potwierdziłem produkcyjny endpoint w bundlu.
   `desktop/skrypty/eksportWeb.js` nie używa `--clear` — przed buildem Windows po jakimkolwiek
   teście z atrapą trzeba wykonać eksport z `--clear` (skryptu nie zmieniałem).
3. Dodatkowa zmiana ponad zlecenie: checklista przekazuje Radarowi termin składania z kalendarza
   postępowania (test UI pokazał „termin nieznany" przy wejściu z checklisty).
4. Radar SWZ i przewodnik pozostają tylko po polsku.
5. Strona **opublikowana przez koordynatora** (Firebase Hosting, wersja `3cb38c164f0b3a4d`); sam
   jej nie publikowałem ani nie sprawdzałem po publikacji. Źródła `landing/regulamin.html`
   i `landing/polityka-prywatnosci.html` nadal są starsze niż produkcja — nie kopiować ich na hosting.
6. Sklepy: teksty w `store/whats-new-1.1.5.md` (PL/EN, bez emoji). Konta recenzji i deklaracje
   prywatności — bez zmian w tej rundzie.

## 6. Kroki publikacji aplikacji (dla koordynatora)

1. Sprawdzić SHA gałęzi `integ/1.1.2` i przejrzeć commity z tabeli.
2. Backend jest już wdrożony; Functions nie wymagają wdrożenia.
3. iOS: po scaleniu na gałąź, z której buduje Codemagic — `ios-release` (appId
   `6a136b1f4213f9c57af79f5b`). Oczekiwane: wersja 1.1.5, numer builda wyższy niż poprzedni.
4. Android: lokalnie wg przepisu (`bundleRelease assembleRelease`; `build.gradle` ma już 17 / 1.1.5)
   **albo** workflow `android-release` w Codemagic (naprawiony — patrz sekcja 3 i uwaga o kodach
   wersji przy mieszaniu buildów lokalnych z CI).
5. Windows: przed `electron-builder` wykonać eksport webowy z `--clear`.
6. Na prawdziwym urządzeniu przejść scenariusz 3 z testu UI na koncie testowym właściciela.
