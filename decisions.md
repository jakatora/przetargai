# Decisions — PrzetargAI

Rejestr decyzji architektonicznych i biznesowych. Najnowsze na górze.

---

## D-041 — Ostatnia runda wydaniowa: płatność zweryfikowana E2E na podpisanych webhookach
**Data:** 2026-07-10 | User: „zrób ostatnie testowanie, przygotuj do wypuszczenia, sprawdź płatność"

**Płatność — pełny cykl życia na kluczach TESTOWYCH** (Stripe CLI `listen` + karta 4242,
prawdziwe podpisane zdarzenia, nie atrapy): magic link (jednorazowość potwierdzona) →
303 → Checkout PL 199 zł/mc (kody promocyjne, cancel→nasza strona) → płatność →
`/upgrade/success` → `checkout.session.completed` → tier=standard + customer + sub
w Firestore → `invoice.paid(subscription_create)` poprawnie pominięty → duplikat
dostawy idempotentny → anulowanie subskrypcji → `customer.subscription.deleted` →
powrót na Free. Fakturownia w degradacji (bez prawdziwych faktur). Null-owy NIP
w metadanych sesji nie przeszkadza (zweryfikowane żywym wywołaniem).

**Narzędzie trwałe:** `firebase/functions/skrypty/serwer-platnosci.mjs` — uprząż
odpalająca produkcyjny `createApp` na :3199 z kluczami sk_test z backend/.env
(bezpiecznik: odmawia pracy na kluczu innym niż `sk_test_`). Lekcja: goły Express
NIE ma `req.rawBody` (Cloud Functions ma) — powłoka `express.raw` tylko dla trasy
webhooka; bez niej weryfikacja podpisu odrzuca wszystko z „No webhook payload".
Zainstalowany globalnie Stripe CLI 1.43.7 (`stripe listen`/`events resend`).

**Ikona iOS naprawiona:** brandowa grafika miała WYPIECZONE zaokrąglenie + białe/szare
narożniki — po masce Apple zostają białe paski, a ASC odrzuca alfę. Przerobiona na
pełnokadrową (kompozycja przez maskę na gradient zszyty z jej własnych krawędzi, PIL);
bez kanału alfa. Wpis w blockers o „placeholderach Expo" był przeterminowany.

**Ostatnia runda testów:** backend 125/125 · Firebase 211/211 · E2E 29/29 · mobile 40/40.
**Werdykt i lista działań właściciela:** `runbooks/wydanie-checklist.md` (GO po stronie kodu).

## D-040 — Przełącznik planów DEMO (porównywanie pakietów bez Stripe)
**Data:** 2026-07-10 | User: „zrób mi przycisk zmiany planów demo, bo chcę zobaczyć różnicę"

**Wymóg bezpieczeństwa (najważniejszy):** endpoint zmieniający plan bez płatności
NIE MOŻE istnieć na produkcji — darmowe konto nadałoby sobie Standard jednym żądaniem.
`POST /demo/tier` (routes/demo.js) jest montowany w app.js WYŁĄCZNIE gdy
`env.NODE_ENV !== 'production'`; strażnik: `test/demoTierProdukcja.test.js`
(osobny proces z NODE_ENV=production → trasa MUSI zwracać 404).

**Żeby różnica była PRAWDZIWA, nie kosmetyczna:** endpoint zmienia `premium_tier`
na backendzie i od razu przelicza dopasowania (`generateMatchesForUser` na otwartej
puli, celowo BEZ cooldownu backfillu — tryb demo przełącza się wielokrotnie).
Zmierzone na podglądzie: stolarz Free = 5 dopasowań (limit dzienny) → Standard =
**+124 od razu**. Mobile: bursztynowa karta „TRYB DEMO" w Koncie widoczna tylko
w `__DEV__`; komunikat inline zamiast `Alert.alert` (Alert nie renderuje się na web).

**Higiena bazy dev:** poranne przebiegi testów (sprzed izolacji portów) zostawiły
w devowym emulatorze 114 przetargów-śmieci i 791 dopasowań/śladów — usunięte
skryptem po prefiksach `mt-/ma-/demo-/zr-`. Testy: Firebase **211/211**.

## D-039 — Monitoring wielu źródeł: architektura + TED; mapa źródeł z listy usera
**Data:** 2026-07-10 | User: „dodaj te strony do monitorowania" (lista ~40 pozycji)

**Mapa listy usera — co zrobiliśmy z każdą grupą:**
- **e-Zamówienia/BZP** — było (jedyne źródło do dziś). **TED — DODANE** (patrz niżej):
  polskie postępowania POWYŻEJ progów UE nie trafiają do BZP; to była największa luka.
  Zmierzone: ~450 ogłoszeń konkursowych PL/dzień — wolumen jak BZP.
- **Komercyjne wyszukiwarki (Portal Przetargowy, Pressinfo, Oferent, Przetargi.info)** —
  ŚWIADOMIE NIE: to nasi KONKURENCI agregujący te same źródła pierwotne; scraping ich
  serwisów = ryzyko prawne i zero danych, których nie mamy taniej u źródła.
- **Platformy zakupowe (Open Nexus/platformazakupowa.pl, Logintrade, Marketplanet
  OnePlace, SmartPZP, eB2B, ezamawiający)** — NAJCENNIEJSZA przyszła warstwa dla JDG:
  zapytania ofertowe PONIŻEJ 130 tys. zł, których NIE MA w BZP. Sonda 2026-07-10:
  brak publicznych API; platformazakupowa.pl ma publiczną listę HTML (parsowalna,
  ale krucha), Logintrade nie ma centralnej listy (tysiące subdomen zamawiających).
  → to osobny program scrapingowy (adapter per platforma + monitoring zmian markupu
  + przegląd ToS/prawny). DECYZJA USERA w blockers.md; architektura już na to gotowa
  (rejestr źródeł przyjmuje kolejne adaptery).
- **Portale spółek (PKP PLK, PGE, Orlen, KGHM, Tauron, Enea, PSE, Gaz-System, PGZ)** —
  większość prowadzi postępowania NA platformach z punktu wyżej (Logintrade/OnePlace/
  eB2B) — dojdą razem z adapterami platform, nie osobno.
- **miniPortal** — martwe archiwum (zastąpiony przez e-Zamówienia) — pomijamy.
- **BIP-y urzędów/instytucji** — tysiące niestrukturalnych stron; formalne ogłoszenia
  i tak lądują w BZP/TED, a ogłoszenia bagatelne z BIP-ów to długi ogon pokrywany
  przez platformy zakupowe. Bez sensu scrapować bezpośrednio.

**Architektura (TDD; testy 191 → 207):**
- Rejestr źródeł w `jobs/fetchTenders.js`: każde źródło = `{nazwa, pobierz()}` zwracające
  znormalizowane przetargi; awaria JEDNEGO źródła nie zatrzymuje pozostałych; `ok:false`
  dopiero gdy padły wszystkie; statystyki per źródło w wyniku (i w `/health` przez cykl).
  DI `zrodla` dla testów. `test/zrodlaPobierania.test.js`.
- Model: `tenders.source` ('bzp'|'ted'; pole `bzp_external_id` zostaje — historyczna
  nazwa, niesie prefiksowane ID `ted:…`), `matches.tender_source` (denormalizacja),
  `publicMatch.tender.source`. Aplikacja: przycisk „Otwórz ogłoszenie w BZP/TED (UE)".
- **Adapter TED** (`services/ted.js`, 12 testów): API `POST /v3/notices/search` —
  publiczne, BEZ klucza (zweryfikowane sondą na żywo). Pola eForms: `title-proc`
  (wielojęzyczne, pol→fallback), `buyer-name`, `classification-cpv` (duplikaty→unikalne),
  `deadline-receipt-tender-date-lot` (per CZĘŚĆ → bierzemy najwcześniejszy; format
  „2026-09-08+02:00" = data z offsetem BEZ godziny → koniec dnia czasu polskiego,
  nie północ). Paginacja z sufitem stron; `TED_ENABLED=false` wyłącza bez deployu.
- **Żywy przebieg na emulatorze:** `fetched 1500 (bzp 500 + ted 1000), matchesCreated 304`.

**Lekcja (pół godziny debugowania):** testy plików RÓWNOLEGŁYCH na wspólnym emulatorze
ścigają się przez GLOBALNE cykle — `generateMatchesForAllUsers()` z jednego pliku
ocenia userów INNEGO pliku (z wyłączonym AI → ślad ostateczny) i zatruwa asercje
o braku śladu. Naprawa klasy problemu: `--test-concurrency=1` w `test:raw`
(pliki sekwencyjnie, wciąż jeden świeży emulator). Diagnostyka, która to złapała,
została w teście (przy porażce wypisuje surowy dokument śladu).

**Strażnik sekretów nauczony wyjątku:** `TED_ENABLED` to przełącznik nie-sekretny
z domyślnym WŁĄCZAJĄCYM — wyjątek w `sekretyFunkcji.test.js` jest samoweryfikujący
(wygasa, gdy default przestanie włączać).

## D-038 — Runda 30 audytu (krytyk kompletności): 21 znalezisk, wszystkie naprawione
**Data:** 2026-07-10 | 4 soczewki workflow: antyregresja / luki testów / dokumentacja / wydanie mobile

**Antyregresja: 0 znalezisk** — wszystkie naprawy z rund 1–29 zweryfikowane w kodzie jako nienaruszone.

**Luki testowe (8) — wszystkie domknięte, testy Firebase 166 → 191:**
- `test/webhookPieniadze.test.js` (13): aktywacja planu po checkoutcie (payment_status,
  nieznany user, strażnik Fittera), faktura odnowienia (`billing_reason` — jedyna bariera
  przed podwójną fakturą za pierwszy miesiąc, bo klucze idempotencji cs_/in_ są rozłączne),
  degradacja/przywrócenie planu, orkiestracja claim→handleEvent→markDone (błąd obsługi
  zwalnia rezerwację + 500; błąd markDone NIE zwalnia — mniejsze zło niż pewny dubel).
  Wymagało wydzielenia `przetworzZdarzenie()` z trasy (refaktor bez zmiany zachowania).
- `test/matchingAi.test.js` (5): silnik Z WŁĄCZONYM AI — awaria AI nie zostawia śladu
  (kandydat wraca do modelu), odpowiedź AI nadpisuje heurystykę, weto AI jest ostateczne,
  wyczerpana kwota dobowa = heurystyka ZE śladem, prefiltr <15 nie kosztuje.
- `test/fakturaDegradacja.test.js` (3): tryb bez Fakturowni nie rzuca i zwalnia rezerwację.
- ai.test.js +2: miękki limit alarmuje ale NIE blokuje; alarm twardy nie jest zagłuszany
  dławieniem miękkiego. firestoreRepos +2: `magicLinks.peek` nie zużywa; `expectedUserId`
  nie pali cudzego tokenu.

**Dokumentacja (8):** runbooki kazały subskrybować 2 zdarzenia Stripe zamiast 6 (klient
płacący przelewem nie dostałby planu; niepłacący by go nie tracił) — deploy.md + api-keys.md
naprawione; wdrozenie-firebase.md: `cd firebase` + krok 3 etapu 6 przez `EXPO_PUBLIC_API_URL`
(w tym Codemagic env); README port 3000→3100 (+.env.example) i `firebase/` w drzewie;
runbooks/README + wpis; blockers.md zaktualizowany o AKTUALNE blokery; plan migracji: status F0–F4.

**Wydanie mobile (5):** google-services.json nieśledzony → strażnik w codemagic.yaml
z czytelnym błędem (plik wejdzie do repo przy najbliższym commicie — to konfiguracja klienta,
nie sekret); bump versionCode był NO-OPEM (prebuild hardkoduje `versionCode 1`, gradle.properties
nieczytane) → sed na build.gradle + weryfikacja grep; capability Push w Apple Portal
udokumentowana (deploy.md §4 + blockers); opis Play kierował do zakupu przez WWW → usunięty
(polityka płatności Play; DECYZJA usera: Play Billing vs ukrycie CTA — blockers.md);
komentarz GCLOUD_→GOOGLE_PLAY_ w codemagic.yaml.

**Infrastruktura testów:** `firebase.test.json` (porty 5002/8090) + `--config` w npm test/test:e2e —
testy startują ŚWIEŻY emulator i nie kolidują z devowym (5001/8081). Lekcja: uruchamianie
zestawu przeciw długo żyjącemu emulatorowi daje fałszywe porażki (budżet AI i unikalne
e-maile kumulują się między przebiegami). smoke.sh: baza przez `SMOKE_BASE`, domyślnie 5002.

**Stan:** Firebase **191/191** + E2E **29/29**, mobile **40/40**, backend Railway 125/125.

## D-037 — Tryb ciemny (przełącznik Systemowy/Jasny/Ciemny)
**Data:** 2026-07-10 | Życzenie usera (zapisane przy D-023: „apka ma mieć przełącznik trybu")

**Problem.** Paleta była statycznym obiektem importowanym przez 11 plików — kolory
zamrażały się przy imporcie, `userInterfaceStyle: "light"` blokował systemową ciemność.

**Rozwiązanie (TDD, 8 testów `test/motyw.test.js`):**
- `src/lib/motyw.js` — czysta logika bez importów RN: `PALETY` (jasny/ciemny),
  `wybierzSchemat(preferencja, systemowy)`, `normalizujPreferencje` (śmieci z magazynu → system).
  Testy pilnują PARYTETU tokenów obu palet (brak tokenu w ciemnej = niewidoczny element)
  i jasności percepcyjnej (ciemne tło ciemne, jasny tekst jasny).
- `src/context/ThemeContext.js` — `ThemeProvider` (preferencja w storage, `useColorScheme()`
  nasłuchuje systemu), `useTheme()`, `useStyle(fabryka)` z cache arkuszy per schemat
  i pomocnik `tworzStyle`. Preferencja jest LOKALNA dla urządzenia (wygląd to cecha
  urządzenia, nie konta — bez kolumny w backendzie; KISS wobec wcześniejszego pomysłu
  `users.theme`).
- Refaktor 11 plików: `theme.js` zostaje geometrią (spacing/radius), kolory przez
  `useStyle`. Nowe tokeny semantyczne zamiast 6 twardych hexów: `wyroznienie`,
  `ostrzezenieTlo/Tekst`, `neutralneTlo`, `sukcesTlo`. Sekcja „Wygląd" w Koncie
  (radiogroup z a11y). `app.json`: `userInterfaceStyle: "automatic"`.
- Nagłówki ekranów zostają brandowo niebieskie w OBU motywach; StatusBar globalnie
  `light`, Login (bez nagłówka) ustawia własny wg schematu.

**QA w przeglądarce:** przełączenie działa natychmiast, trwałość przez przeładowanie
strony, powrót na Systemowy natychmiastowy. Testy mobile 32 → 40.

## D-036 — Ściąga kodów CPV wbudowana w aplikację
**Data:** 2026-07-10 | Feedback usera: „przydałaby się ściąga, które kody CPV są przypisane do czego"

**Problem.** Kody CPV to najsilniejszy sygnał silnika dopasowań (prefiks 5+ cyfr → waga 0.8;
dział → 0.35), ale persona JDG ich nie zna — pole zostawało puste i dopasowanie jechało
na samych słowach kluczowych.

**Rozważone opcje.** (A) Statyczna strona pomocy — użytkownik dalej przepisuje kody ręcznie,
literówki zostają. (B) Interaktywna ściąga wbudowana w apkę. (C) Pełny słownik CPV (9 454
pozycje) serwowany z backendu — zbędna zależność sieciowa dla danych z rozporządzenia UE,
które się nie zmieniają; wroga UX dla fachowca. **Wybrano B.**

**Implementacja (TDD, 13 testów `test/cpvKatalog.test.js`):**
- `mobile/src/lib/cpvKatalog.js` — katalog: WSZYSTKIE 45 działów CPV (test pilnuje kompletności —
  żadna branża nie trafia w pustkę) + ~60 najczęstszych klas dla typowych JDG. Nazwy uproszczone,
  kody gołe 8-cyfrowe (forma kanoniczna backendu; cyfra kontrolna i tak jest odcinana).
- Wyszukiwarka porównuje RDZENIE słów — port stemmera z `functions/src/lib/textNorm.js`
  („sprzatanie" bez ogonków trafia w „Usługi sprzątania"). Duplikat algorytmu świadomy:
  osobne pakiety bez wspólnej biblioteki; przy zmianie zaktualizować oba pliki.
- `przelaczKod()` — tap dodaje/usuwa kod z tekstu pola; jedno źródło prawdy to POLE
  (modal nie trzyma własnych zaznaczeń, nie może się rozjechać z ręczną edycją).
- `mobile/src/components/CpvPicker.js` — modal z FlatList, checkboxy z accessibility,
  licznik na przycisku „Gotowe (N)". Podpięty w Rejestracji i Koncie linkiem
  „Nie znasz kodów? Otwórz ściągę CPV →".

**Zweryfikowane w przeglądarce na emulatorze:** wyszukiwanie z fleksją, zaznaczanie,
zapis profilu na backend (`cpv_codes: ['45420000','39100000','90910000']`). Testy mobile 32/32.

## D-035 — Ręczny przelot aplikacji przez przeglądarkę (emulator Firebase)
**Data:** 2026-07-10

Uruchomiłem cały stos lokalnie — emulator Firebase (functions + Firestore) z pustymi
kluczami płatnych usług (`features.* = false`, zero kosztów) i aplikację mobilną w wersji
web (Expo) wskazaną na emulator. Zasiliłem bazę 500 realnymi przetargami z BZP i przeszedłem
ścieżkę użytkownika: rejestracja → feed → szczegóły → feedback → konto.

**Zmiana konfiguracji:** `mobile/src/config.js` — dodana zmienna `EXPO_PUBLIC_API_URL`,
która nadpisuje adres backendu przy budowaniu. Bez niej zachowanie bez zmian (DEV = lokalny
IP z Expo, PROD = Railway). Dzięki temu można wskazać aplikację na emulator albo na wdrożone
funkcje bez edytowania kodu — to samo posłuży do przełączenia na Firebase w etapie 6 wdrożenia.

**Potwierdzone działa:** poprawka rejestracji (NIP usunięty, „Powtórz hasło" z walidacją
niezgodności), dopasowania heurystyczne (przy pustym kluczu AI — feed pokazuje „Dopasowanie
automatyczne"), feedback 👍/👎, magazyn tokenu z fallbackiem na web.

**Dwie usterki kosmetyczne znalezione i naprawione (TDD):**
- Kody CPV z BZP to jeden sklejony string bez spacji po przecinku → nowy `mobile/src/lib/cpv.js`
  rozdziela je do osobnych linii, ale tylko po przecinkach spoza nawiasów (nazwy CPV same mają
  przecinki), i przełącza etykietę „Kod CPV"/„Kody CPV". 6 testów.
- Przycięte „Konto" w nagłówku feedu → `marginRight: 16` na przycisku.

Testy mobile: 13 → 19. Ostrzeżenia konsoli (push token na web, `pointerEvents` z react-navigation)
nieszkodliwe i webowe. Wdrożenie backendu na Firebase nadal czeka na zgodę użytkownika (D-024).

## D-034 — Audyt rundy 26–29: domknięcie wszystkich znalezisk
**Data:** 2026-07-10 | Raport: `plans/AUDYT-2026-07-10-rundy-26-30.md` (46 znalezisk, 6 obalonych)
**Runda 30 (krytyk kompletności) NIE została wykonana** — 3 agenty padły na limicie sesji.

**HIGH — porównanie terminów kłamało.** Cała baza porównuje daty leksykograficznie
(`deadline > now`), a BZP miesza formaty i strefy. Zmierzone kontrprzykłady:
`2026-07-10T13:30:00+02:00` (realnie 11:30 UTC, termin MINĄŁ) tekstowo wygląda na przyszły;
`2026-07-10T11:00:00-02:00` (realnie 13:00 UTC, OTWARTY) wygląda na miniony. Przetargi po
terminie wracały do płatnego AI, otwarte wypadały z puli. `lib/daty.js` normalizuje do UTC
przy WEJŚCIU danych; data bez strefy to czas POLSKI (nie UTC — inaczej termin przesuwa się
o 2 h w przyszłość), a sama data bez godziny to koniec dnia. 7 testów.

**HIGH — odnowienia subskrypcji bez faktury VAT.** Fakturę wystawialiśmy tylko przy pierwszym
checkoucie; klient płacił co miesiąc, dokument dostawał raz. Obsłużone `invoice.paid`
z `billing_reason === 'subscription_cycle'` (pierwszy okres pomijamy — obsłużył go checkout,
a rezerwacja `invoices/{id}` chroni przed dublem).

**MEDIUM — kwota faktury zaszyta na sztywno.** 199 zł netto niezależnie od tego, ile klient
zapłacił. Kod rabatowy → zawyżony VAT i błąd księgowy po obu stronach. Teraz `session.amount_total`
ze Stripe; cena katalogowa tylko jako zapas (lepsza faktura zawyżona niż żadna).

**HIGH — feed nieświadomy terminu i źródła oceny.** Przetargi po terminie zostawały bez żadnego
oznaczenia (użytkownik szykował ofertę na zamknięte postępowanie), a mechaniczne trafienie
w słowo kluczowe wyglądało identycznie jak ocena modelu. `mobile/src/lib/termin.js`
(`opisTerminu` + `opisOceny`, 7 testów): karta pokazuje „Termin minął" / „Zostało 3 dni",
wygaszamy minione, wyróżniamy pilne (≤7 dni); szczegóły mówią wprost „Ocena AI" albo
„Dopasowanie automatyczne".

**HIGH — push tylko przy logowaniu.** Kto dopłacał do Standardu w trakcie sesji, nie był pytany
o uprawnienie i nie wysyłał tokenu — **płacił za powiadomienia, których nie dostawał**, aż do
następnego zalogowania. `zarejestrujPush()` wołane też po potwierdzeniu aktywacji planu.

**MEDIUM — cykl zakleszczał się na wadliwym użytkowniku.** `last_cycle_at` ustawiany tylko po
sukcesie, więc konto, którego dopasowania stale się wywracają, na zawsze zostawało na początku
kolejki i codziennie blokowało miejsce innym. Teraz znacznik w `finally` — kolejka ma być
sprawiedliwa, nie pamiętliwa.

**Weryfikacja:** Firebase 166/166 (skipped 0) + E2E; backend 125/125; mobile 13/13.

## D-033 — Audyt rundy 21–25: martwy catch, martwy strażnik, martwe pokrycie
**Data:** 2026-07-10 | Raport: `plans/AUDYT-2026-07-10-rundy-21-25.md` (57 znalezisk, 12 obalonych)

**HIGH — regresja mojej własnej idempotencji faktury.** `createStandardInvoice` NIGDY nie rzuca:
łapie każdy błąd Fakturowni i zwraca `{ created: false }`. Mój `catch` był więc **kodem martwym**,
a rezerwacja `invoices/{session.id}` zostawała na zawsze. Przy awarii Fakturowni (albo w trybie
degradacji, gdy nie jest skonfigurowana) opłacony klient B2B **nigdy nie dostawał faktury VAT**
i nie było ścieżki naprawy — ponowienie widziało „faktura już istnieje". Teraz sprawdzamy WYNIK,
a nie wyjątek; przy `created !== true` zwalniamy rezerwację. `test/fakturaPonowienie.test.js`
koduje to wprost, łącznie z asercją, że funkcja faktycznie nie rzuca.

**HIGH — strażnik indeksów pilnował złego pliku.** Skanował wyłącznie `db/repos.js`, a jedyne
zapytanie, które NIGDY nie zadziała bez jawnego indeksu (`collectionGroup('matches').orderBy(...)`),
mieszka w `routes/admin.js`. Teraz skanuje cały `src/`, z asercją, że naprawdę widzi oba pliki.

**HIGH — cała płatna gałąź AI bez testów.** Każdy test wyłączał AI (`ANTHROPIC_API_KEY = ''`),
więc `services/ai.js` i ścieżka `scorer === 'ai'` nie miały ŻADNEGO pokrycia. Nowy `test/ai.test.js`:
`parseScore` (model dodaje prozę wokół JSON-a, zwraca wartości spoza zakresu, bełkocze), księgowanie
kosztu co do grosza, degradacja przy awarii sieci i **dowód, że bramka budżetu blokuje wywołanie
PRZED wyjściem do sieci**. Pułapka: SDK Anthropica zapamiętuje `globalThis.fetch` przy imporcie —
atrapę trzeba zainstalować wcześniej.

**HIGH — feed kasował dane przy błędzie sieci.** Powrót na ekran w metrze albo nieudane pociągnięcie
w dół wymazywało całą listę i pokazywało pełnoekranowy błąd. Teraz pełnoekranowy komunikat tylko
wtedy, gdy nie ma CZEGO pokazać; w przeciwnym razie pasek „nie udało się odświeżyć, pokazujemy
ostatnio pobrane".

**HIGH — `DELETE /auth/me` nie istniało na Railway**, a aplikacja wciąż tam celuje: nowy ekran
usuwania konta dostałby 404. Dodane z tą samą semantyką (hasło, blokada przy subskrypcji — ten
backend nie anuluje Stripe). Test dowodzi, że kaskada SQLite czyści dopasowania i feedback,
zostawiając przetargi, i że nie ma sierot.

**Znane, świadomie odłożone do wdrożenia (F6/F7):** mobile `API_URL` wskazuje Railway; po deployu
Firebase trzeba go przełączyć i wygasić cron oraz webhook PrzetargAI na Railway (inaczej dwa
harmonogramy liczą dopasowania równolegle, z osobnymi licznikami budżetu). `versionCode` utyka
na 1 (Play odrzuci aktualizację), brak `extra.eas.projectId` (token push zawsze `null`),
App Store 3.1.1 — opis w `store/listing.md` kieruje do zakupu przez WWW.

**Weryfikacja:** Firebase 154/154 (skipped 0) + E2E; backend 125/125.

## D-032 — Dobowy limit AI na urządzenie (Fitter) + domknięcia
**Data:** 2026-07-10

**Druga warstwa obrony przed denial-of-wallet w Fitterze.** D-025 dodało bramkę budżetu,
ale ta odpala się dopiero po przepaleniu limitu miesięcznego. Trasy `/api/fitter/scan-iso`
i `/api/fitter/ai` są nieuwierzytelnione, a `device_id` to dowolny tekst od klienta —
limiter na adres IP obchodzi się z wielu adresów. Migracja `003_ai_quota_device.sql`
+ `repos.aiQuotaDevice`: dobowy limit per urządzenie, zależny od statusu Premium
(skan 60/3, czat 200/15). **Nie odcinamy darmowych użytkowników** — to byłaby zmiana
produktowa w cudzej apce; sprawiamy tylko, że nadużycie kosztuje atakującego tyle
samo pracy, co uczciwe korzystanie.
`device_id` w czacie pozostaje OPCJONALNE (wymóg zepsułby starsze wersje apki), ale
jego brak nie omija limitu: anonimowe urządzenie kluczujemy adresem (`anon:<ip>`).

**Domknięcia po rundach 16–20:**
- `DELETE /auth/me`: po anulowaniu subskrypcji od razu zdejmujemy plan i czyścimy
  `stripe_subscription_id`. Gdyby kasowanie padło niżej, użytkownik zostałby z płatnym
  planem, za który nikt nie płaci.
- `invoices` dostało TTL (rok) — rejestr chroni przed dublem, nie jest księgowością.
- `test/retencja.test.js`: dowodzi, że `Date` zapisuje się jako `Timestamp` (TTL działa
  WYŁĄCZNIE na Timestampach) i że każda kolekcja z polem `ttl` ma politykę w indexes.json.
  Osobna asercja pilnuje, by nikt nie zadeklarował TTL na polu tekstowym.

**Weryfikacja:** backend 120/120, Firebase 139/139 (skipped 0), E2E.

## D-031 — Audyt rundy 16–20: testy, które kłamały, i podwójna faktura
**Data:** 2026-07-10 | Raport: `plans/AUDYT-2026-07-10-rundy-16-20.md` (52 znaleziska, 7 obalonych)

**Zestaw testów kłamał o pokryciu.** Pliki integracyjne używały `{ skip }`, gdy nie wykryły
emulatora — `npm test` bez emulatora pomijał **38 testów** (warstwa danych, silnik dopasowań,
usuwanie konta, idempotencja webhooków) i kończył się na zielono. Teraz brak emulatora to BŁĄD
(`test/emulator.js`), a `npm test` sam go uruchamia. Weryfikacja: `skipped 0`.

**Testy reguł planu sprawdzały swoją własną kopię reguły.** Tabela decyzyjna „kto ma płatny
plan" była przepisana w teście, więc przechodził on także wtedy, gdy webhook decydował inaczej.
Reguła mieszka teraz w `lib/subscriptionStatus.js` i jest importowana przez kod ORAZ test.
Sprawdzone przez celowe zepsucie reguły: test pada.

**Podwójna faktura VAT.** Rejestr zdarzeń nie wystarczał: gdy `markDone` padnie już PO udanej
obsłudze, rezerwacja wygasa po 5 min, a ponowna dostawa (Stripe dostarcza „co najmniej raz")
przetwarza zdarzenie od nowa. Fakturownia nie ma klucza idempotencji → klient dostawał drugą
fakturę. Nowa kolekcja `invoices/{session.id}` rezerwuje wystawienie; błąd zwalnia rezerwację.

**Subskrybent nie mógł usunąć konta.** RODO art. 17 i wymóg Google Play nie znają wyjątku
„bo klient płaci". Zamiast odmawiać, anulujemy subskrypcję w Stripe (`anulujSubskrypcje`),
a dopiero potem kasujemy dane. Gdy Stripe zawiedzie — konto ZOSTAJE (nie kasujemy danych,
dopóki karta może być obciążana).

**Regresja mojej własnej poprawki:** alarm o twardym limicie budżetu AI był zagłuszany przez
wcześniejszy alarm miękki — dzieliły jeden licznik dławienia. Osobne liczniki per rodzaj.

**Głodzenie użytkowników z szerokim profilem.** Ranking był obcinany do 120 kandydatów PRZED
odsianiem ocenionych: gdy czołowa setka miała już ślad, silnik nie sięgał do 121. i taki user
nie dostawał NIC, codziennie. Teraz okno przesuwne (`OKNO_KANDYDATOW`) z bezpiecznikiem kosztowym.

**Retencja danych.** `magic_links` miały zadeklarowany TTL na polu tekstowym — Firestore kasuje
wyłącznie po polach typu `Timestamp`, więc polityka **nie robiła nic**. Dodane pole `ttl`
(Timestamp) do `magic_links`, `audit_logs` (90 dni — zawierają adresy IP i przeżywały usunięcie
konta) i `stripe_events` (30 dni; Stripe ponawia najwyżej 3 dni).

**Weryfikacja:** Firebase 133/133 (skipped 0) + E2E; mobile bez błędów składni.

## D-029 — RODO, odporność BZP, paginacja bez gubienia danych
**Data:** 2026-07-10

**RODO art. 17 — usunięcie konta.** Nie istniało w ogóle, a regulamin obiecywał realizację
prawa „na e-mail". Ręczne kasowanie w Firestore to pułapka: **usunięcie dokumentu NIE usuwa
podkolekcji** — osierocone `matches`, `evaluations`, `ai_quota` i `meta` zostawałyby na zawsze,
a rezerwacje `unique/email:…` blokowałyby ponowną rejestrację. `users.usunKonto()` używa
`recursiveDelete` + jawnie zwalnia rezerwacje i magic linki. `DELETE /auth/me` wymaga
potwierdzenia hasłem (token bywa na urządzeniu, które nie jest w rękach właściciela) i odmawia
przy aktywnej subskrypcji (Stripe obciążałby kartę za nieistniejące konto). Ekran „Usunięcie
konta" w aplikacji — **Google Play tego wymaga**, mail do administratora nie wystarcza.
`ai_usage` i `audit_logs` zostają: inna podstawa prawna (art. 6 ust. 1 lit. c i f).

**Paginacja gubiła dopasowania.** Kursor po samym `created_at` był bezużyteczny: 200 kolejnych
zapisów daje **2 różne znaczniki** (rozdzielczość milisekundy), więc kursor przeskakiwał całe
grupy albo je dublował. Teraz kursor złożony `"<created_at>|<id>"` + jawne `orderBy(documentId)`
(bez niego Firestore odrzuca dwuczłonowy kursor: „Too many cursor values"). Test przechodzi
feed stronami i sprawdza kompletność przy WYMUSZONEJ kolizji znaczników.

**Odporność integracji:**
- klient Anthropica miał domyślny timeout **10 minut** — jedno zawieszone wywołanie zjadłoby
  cały 540-sekundowy budżet cyklu; teraz 30 s i jedno ponowienie;
- BZP nie miało ponowień: jednorazowa usterka sieci = brak przetargów **na całą dobę**
  (cykl biegnie raz dziennie). Trzy próby, rosnący odstęp, ponawiamy tylko 429/5xx;
- wczesne ostrzeżenie o zmianie schematu BZP: gdy >50% ogłoszeń bez tytułu lub >90% bez CPV,
  `logger.error` — inaczej feed po cichu wypełniłby się wpisami „Bez tytułu".

**Weryfikacja:** Firebase 125/125 + E2E (z usuwaniem konta i ponowną rejestracją tego e-maila).

## D-028 — Audyt rundy 11–15: koszty, skala, regresje własnych napraw
**Data:** 2026-07-10 | Raport: `plans/AUDYT-2026-07-10-rundy-11-15.md` (55 znalezisk, 3 obalone)

**CRITICAL — denial-of-wallet przez `PATCH /auth/me`.** Każda zmiana kryteriów odpalała
`backfillUser` → `openPool()` = do 4000 odczytów Firestore. Limiter dopuszcza 120 żądań/min,
więc jedno darmowe konto przełączające słowa kluczowe generowało ~480 tys. odczytów/min.
`aiQuota` tego nie broniła — pilnuje wyłącznie wydatków na AI, a odczyty puli są PRZED nią.
Naprawa dwutorowa: (1) **cache puli w pamięci instancji** (TTL 10 min; cron jawnie unieważnia
po pobraniu BZP) — pula zmienia się raz na dobę, więc czytanie jej na każde żądanie było
marnotrawstwem; (2) `backfillCooldown` — 10-minutowy odstęp na użytkownika, omijany przez
rejestrację i admina (`wymus: true`).

**REGRESJA WŁASNEJ NAPRAWY (D-027).** `createWithEvaluation` używa `batch.create`, a ten na
istniejącym dokumencie wywraca CAŁY batch — więc ślad oceny NIE powstawał, gdy dopasowanie
już było. `idsAmong` nie odsiewał kandydata i **codziennie płaciliśmy AI za ten sam przetarg**.
Naprawa: `ALREADY_EXISTS` → zapis samego śladu. Test regresyjny w `firestoreRepos.test.js`.

**REGRESJA WŁASNEJ NAPRAWY (klucz limitera).** „Bierz przedostatni wpis `X-Forwarded-For`"
zakładało jedną topologię. Dokumentacja Google jest **wewnętrznie sprzeczna**: strona Cloud
Functions mówi „pierwszy = klient" (a to wpis od klienta!), dokumentacja load balancera —
że warstwa pośrednia dopisuje na końcu. Każda pozycja liczona od końca to zgadywanie.
Rozwiązanie niezależne od topologii: odetnij z końca adresy infrastruktury (zakresy Google
130.211.0.0/22 i 35.191.0.0/16, sieci prywatne, localhost) i weź ostatni pozostały.
10 testów, w tym topologia, która obalała poprzednią wersję.

**Skala i koszty:**
- Cykl dzienny był **sekwencyjny** i ginął po 540 s (twardy limit funkcji zdarzeniowych),
  cicho gubiąc userów z końca listy — **codziennie tych samych**. Teraz: porcje po 5 równolegle,
  budżet czasu 440 s, kolejność wg `last_cycle_at` rosnąco (pominięci idą pierwsi).
- `aiQuota.reserve` biegło dla KAŻDEGO kandydata, także po wyczerpaniu limitu — transakcja
  (odczyt+zapis) ×120, żeby usłyszeć „nie". Teraz kwota czytana raz, licznik lokalny.
- `budgetStatus()` robiło 2 odczyty przed KAŻDYM wywołaniem AI → cache 30 s (admin czyta świeży).
- `matches.listForUser` używało `offset()` sterowanego przez klienta (Firestore nalicza każdy
  pominięty dokument) → **paginacja kursorem** `?before=<created_at>`, `next_before` w odpowiedzi.

**Webhook:** błąd `markDone` PO udanej obsłudze wołał `release()` → Stripe przetwarzał wszystko
drugi raz (druga faktura). Rozdzielone bloki try.
**Cron:** `dailyTenderFetch` logował sukces nawet gdy BZP padło albo cykl dopasowań się wywalił.
Teraz rzuca — Scheduler odnotuje niepowodzenie i ponowi.

**Mobile:** feed bez paginacji (starsze dopasowania nieosiągalne) → „załaduj więcej" kursorem;
plan po powrocie ze Stripe sprawdzany raz, przed webhookiem → odpytywanie z odstępem + uczciwy
komunikat, gdy się nie doczekamy. Dodany `npm run check` (esbuild) — mobile nie miało ŻADNEJ
weryfikacji składni, literówka w JSX wychodziła dopiero po 5 min budowania APK.

**Weryfikacja:** Firebase 112/112 + E2E 21/21; backend 115/115.

## D-027 — Audyt rundy 6–10: dwa CRITICAL w nowym kodzie Firebase
**Data:** 2026-07-10 | Raport: `plans/AUDYT-2026-07-10-rundy-6-10.md` (57 znalezisk, 3 obalone)

**CRITICAL 1 — silnik dopasowań byłby martwy na produkcji.** `openPool()` robiło
`where('deadline','==',null).orderBy('fetched_at','desc')`. Firestore obsługuje równość
+ sortowanie po INNYM polu wyłącznie przez indeks złożony; indeksu nie było, więc zapytanie
rzucało FAILED_PRECONDITION, a że obie gałęzie szły przez `Promise.all` — padała cała pula,
z nią cron, backfill po rejestracji i `/admin/fetch-tenders`. **Emulator Firestore NIE
egzekwuje indeksów złożonych**, więc 86 testów i pełny E2E świeciły na zielono.
Naprawa: gałąź `deadline == null` bez `orderBy` (kolejność nieistotna — pulę rankuje
heurystyka). Zabezpieczenie: `test/indeksyFirestore.test.js` czyta ŹRÓDŁO i odrzuca każde
zapytanie wymagające niezadeklarowanego indeksu. Test sprawdzony przez celowe przywrócenie błędu.

**CRITICAL 2 — wszystkie limity żądań były martwe.** `createApp()` w handlerze budowało
apkę (i liczniki `express-rate-limit` w pamięci) przy KAŻDYM żądaniu. Zgadywanie hasła
i klucza administratora bez ograniczeń. Naprawa: aplikacja budowana raz na instancję
(cache obietnicy, żeby równoległe pierwsze żądania nie zbudowały dwóch).

**HIGH — obejście limitera przez spoofing.** Klucz brał PIERWSZY wpis `X-Forwarded-For`,
czyli wartość od klienta. Load balancer Google dopisuje swój adres na końcu, więc ufamy
PRZEDOSTATNIEMU. Logika w `lib/clientKey.js` + 6 testów (m.in. rotacja adresów IPv6 w /56).

**HIGH — silnik dopasowań:** (a) ślad oceny zapisywany PRZED dopasowaniem → przejściowy błąd
gubił kwalifikujący się przetarg na zawsze; teraz `matches.createWithEvaluation()` — jeden batch.
(b) Ocena heurystyczna po awarii/limicie AI zostawiała ślad → przetarg NIGDY nie wracał do modelu;
teraz ślad tylko dla oceny OSTATECZNEJ (AI odpowiedziało albo nie było po co pytać).
(c) Usunięty `matches.exists` z pętli — odczyt na każdego kandydata; odsiewa `evaluations.idsAmong`.

**HIGH — płatności:** `checkout.session.async_payment_succeeded` nieobsługiwane, więc klient
płacący przelewem nigdy nie dostawał planu (bramka `payment_status` go wstrzymywała, a dopłaty
nikt nie słuchał) — naprawione w OBU backendach. Rezerwacja zdarzenia Stripe wygasa po 5 min:
gdy instancja padnie po `claim()`, ponowienie może dokończyć robotę zamiast zobaczyć „duplikat".

**HIGH — `FAKTUROWNIA_DOMAIN`** nie miał kanału dostawy do funkcji, więc `features.invoicing`
było ciche wyłączone mimo wgranego klucza: **brak faktur VAT dla płacących**. Zabezpieczenie:
`test/sekretyFunkcji.test.js` porównuje zmienne sterujące `features.*` z listą sekretów funkcji.

**MEDIUM — odporność:** `fetchTenders` zapisuje ogłoszenia pojedynczo w osobnych `try`
(jedno przeterminowane 1 MiB wywalało całą partię 500) + `raw_data` przycinane do 700 KiB.

**Mobile:** przejściowy błąd sieci przy starcie wyrzucał zalogowanego usera na ekran logowania
(token zostawał, ale `user` był `null`, a na to patrzy nawigacja). Profil zapisywany lokalnie
i odtwarzany offline; `signOut` go kasuje, żeby nie został po poprzednim koncie.

**Weryfikacja:** Firebase 104/104 + E2E 19/19; backend 115/115.

## D-026 — Naprawy płatności i limitów (audyt, runda naprawcza 2)
**Data:** 2026-07-10
Backend Railway (obsługuje jeszcze Fittera) + port Firebase:
1. **Fitter tracił Premium natychmiast po „nie odnawiaj".** `cancel_at_period_end`
   mapowano wprost na `'canceled'`, mimo opłaconego okresu. Reguły „kto ma dostęp"
   wydzielone do `lib/subscriptionStatus.js` (czyste funkcje + 6 testów). Przy okazji:
   statusy Stripe spoza CHECK w schemacie (`trialing`, `paused`) rzuciłyby wyjątkiem
   w środku webhooka — teraz są mapowane.
2. **`customer.subscription.updated` działa dla PrzetargAI** (dotąd tylko Fitter):
   klient z wygasłą kartą zachowywał Standard bez końca. `past_due` świadomie
   zachowuje dostęp (Stripe wciąż ponawia obciążenie).
3. **Idempotencja webhooków** — migracja `002_stripe_events.sql` + `repos.stripeEvents`.
   Powtórna dostawa zdarzenia wystawiała DRUGĄ FAKTURĘ. Błąd obsługi zwraca teraz 500
   (Stripe ponowi) zamiast cichego 200, po którym opłacony klient zostawał bez subskrypcji.
4. **`payment_status` sprawdzany przed aktywacją** — przelew/odroczone metody kończą
   sesję zanim pieniądze wpłyną.
5. **Limitery**: `/admin` (jedyny router bez żadnego) → 20/15 min; trasy AI Fittera
   (`/api/fitter/scan-iso`, `/api/fitter/ai`) → 6/min zamiast 120/min. Bramka budżetu
   z D-025 jest ostatnią linią obrony; ten limiter ma sprawić, by do niej nie dochodziło.
6. **Klucz limitowania w Functions**: `req.ip` bywa `undefined` za warstwą pośrednią
   Cloud Functions (potwierdzone na emulatorze) — bez własnego `keyGenerator` wszyscy
   klienci wpadliby do jednego kubełka. `ipKeyGenerator` normalizuje IPv6 do /56.

**Weryfikacja:** `test/migracjaProdukcji.test.js` — próba generalna na bazie w kształcie
produkcji (płacący klient + FK): obie migracje przechodzą, dane i plan nietknięte.
Backend 115/115. Firebase 86/86 + `test-e2e/smoke.sh` 12/12 na emulatorze Functions.

## D-025 — Audyt 10-rundowy: naprawy krytyczne i przebudowa scoringu
**Data:** 2026-07-09
Audyt wielo-agentowy (rundy 1–5, 95 agentów, weryfikacja adwersaryjna 2 sceptyków
na znalezisko, 3 obalone). **72 unikalne znaleziska** → `plans/AUDYT-2026-07-09.md`.

**Naprawione natychmiast (dotyczą żywej produkcji):**
1. **CRITICAL — denial-of-wallet przez Fittera.** `/api/fitter/scan-iso` (Sonnet 4.6,
   wizja) i `/api/fitter/ai` są nieuwierzytelnione i wołały Claude'a BEZ sprawdzenia
   budżetu — bramkę miał tylko `scoreTenderMatch`. Budżet jest wspólny (`ai_usage` nie
   ma kolumny projektu), więc atak na Fittera gasił matching AI płacącym userom
   PrzetargAI. Wprowadzona wspólna bramka `aiBudgetAllows(operation)` w `services/ai.js`,
   wpięta w `fitterScan.js` i `fitterAi.js` (503 zamiast płatnego wywołania).
   Testy: `test/aiBudgetGate.test.js`.
2. **HIGH — scoring karał za dobry profil (P-5).** Wynik = `trafione / WSZYSTKIE słowa × 100`,
   więc każde dopisane słowo kluczowe obniżało wyniki: 1 słowo → 100, 5 słów → 20.
   **Zmierzone na 500 realnych ogłoszeniach: profil drogowca (8 słów + CPV) miał
   1 dopasowanie ≥60, teraz 88.** Nowa formuła: nasycenie po LICZBIE TRAFIEŃ
   (`1 − 0.38^trafienia`, 1 → 62 pkt), sygnały łączone probabilistycznie
   `1 − (1−kw)(1−cpv)`, bez sztucznego przycinania sumy.
3. **HIGH — profil oparty tylko na CPV nigdy nie przekraczał progu (P-6):** premia +30
   przy progu 60. Dokładny kod CPV waży teraz 70 (0 → 20 dopasowań na 500 ogłoszeń).

**Naprawione w porcie na Firebase (F3):**
4. Dobowy limit płatnych wywołań AI **na użytkownika** (`aiQuota`, Free 10 / Standard 120) —
   dotąd konto Free mogło przez `PATCH /auth/me` wypompować wspólny budżet miesięczny.
5. Budżet przebiegu maleje przy **próbie**, nie przy sukcesie (nieudane wywołanie też kosztuje).
6. **Każda** ocena zostawia ślad w `evaluations` — także odrzucająca; odrzucony kandydat
   nie wraca jutro do płatnego AI. Ślad przypięty do `criteria_hash`, więc zmiana profilu
   wymusza re-ocenę (§6.14), a powrót do poprzednich kryteriów jej NIE wymusza.

**Pozostaje otwarte** (`plans/AUDYT-2026-07-09.md`): 13 znalezisk w `webhooks.js`
(brak idempotencji, brak obsługi `subscription.updated` dla PrzetargAI → niepłacący
zachowuje tier), 7 w `mobile/src/api/client.js` (brak obsługi 401), `authLimiter`
obejmujący `GET /auth/me` (CGNAT), `/admin` bez rate limitera, kwota faktury zaszyta
na sztywno. Adresowane w etapach F4–F6 migracji.

**Pułapka narzędziowa (odnotowana):** `node --env-file` NIE nadpisuje zmiennych już
obecnych w środowisku. `ANTHROPIC_API_KEY` ustawiony globalnie w Windows sprawił, że
test na emulatorze wykonał PRAWDZIWE wywołanie Haiku. Testy dotykające `config.js`
zerują klucz jawnie przed importem.

## D-024 — Backend przechodzi z Railway na Firebase (pełna migracja)
**Data:** 2026-07-09
Decyzja usera (potwierdzona po przedstawieniu kosztów — kilka-kilkanaście dni pracy).
Plan i architektura: `plans/MIGRACJA-FIREBASE.md`. Kluczowe punkty: Cloud Functions v2
(Express opakowany w onRequest, region europe-central2), Firestore zamiast SQLite
(model bez JOIN-ów: matches/evaluations jako subkolekcje usera), onSchedule zamiast
node-cron, sekrety w Secret Manager. **Railway zostaje jako rollback do końca F7,
Fitter Welder Pro NIE przechodzi** (zostaje na Railway na stałe). Czysta logika
(cpv/textNorm/scoring/pricing, trasy, walidacje) przechodzi bez zmian.
F0 wykonane: projekt Firebase `przetargai`, apka Android `pl.przetargai.app`,
`google-services.json` w mobile/ + wpis w app.json (to domyka też bloker push/FCM).
Czeka: F0b — user musi włączyć Blaze (karta) w konsoli Firebase.

## D-023 — Rejestracja bez NIP-u + „Powtórz hasło" (migracja 001)
**Data:** 2026-07-09
Feedback usera po teście APK na telefonie: NIP przy rejestracji zbędny; brak pola
„powtórz hasło" grozi literówkami. Zbieżne z §7 planu (persona JDG).
**Backend:** migracja `001_users_nip_opcjonalny.sql` — przebudowa `users`
(`company_nip` i `company_name` bez NOT NULL; UNIQUE na NIP zostaje — SQLite
ignoruje NULL-e w UNIQUE). NIP podany dobrowolnie nadal walidowany (suma kontrolna
+ unikalność). Szablony e-mail i faktura z webhooka tolerują brak nazwy/NIP-u
(faktura imienna: puste `buyer_tax_no`).
**Runner migracji rozbudowany:** (1) `PRAGMA foreign_keys=OFF` przed transakcją
+ jawny `PRAGMA foreign_key_check` przed COMMIT (przebudowy tabel z FK);
(2) `stampMigrations` — ŚWIEŻA baza dostaje aktualny `schema.sql`, a migracje są
tylko stemplowane; odtwarzanie historycznych przebudów na aktualnym kształcie
cofałoby schemat. Konsekwencja: zmiana istniejącej tabeli = wpis w `schema.sql`
ORAZ migracja.
**Mobile:** `RegisterScreen` bez NIP-u i nazwy firmy, z polem „Powtórz hasło"
(walidacja zgodności przed wysyłką); `AccountScreen` ukrywa pusty NIP.
**⚠️ Wdrożenie:** nowa apka wymaga deployu backendu na Railway (stary backend
odrzuci rejestrację bez NIP-u jako 400) + migracja 001 wykona się na prod DB
przy starcie. Testy: `test/registerNoNip.test.js` odtwarza pełną ścieżkę
aktualizacji (stara baza z danymi i FK → migracja → rejestracja bez NIP-u).

## D-022 — E2: pula kandydatów + limit AI na przebieg (AI_RERANK_TOP_N)
**Data:** 2026-07-09
Naprawa P-4 wg planu §6.14: `tenders.candidatesForUser(userId, limit)` (LEFT JOIN
`matches`, otwarty lub pusty `deadline`) zastępuje „tylko nowe z tego cyklu".
Dzienny limit Free **odracza** nadwyżkę na jutro zamiast ją kasować. Backfill
wyniesiony do `services/matching.js` (`backfillUser`) i wołany z 3 miejsc:
rejestracja, **`PATCH /auth/me` przy zmianie keywords/cpv** (wcześniej zmiana
profilu nie działała na istniejące ogłoszenia) i `/admin/match-user/:id`.
**Decyzja poza literą planu (zgodna z §5):** przetarg oceniony poniżej progu nie
zostawia śladu w `matches`, więc naiwna pula wracałaby do płatnego AI codziennie
aż do deadline'u (setki wywołań/user/dzień dla Standard). Dlatego pulę rankuje
darmowa heurystyka, a AI ocenia tylko czołówkę — `AI_RERANK_TOP_N=30` na usera
na przebieg (kierunek §5: AI re-rank top N). `evaluateMatch(..., { ai: false })`
wymusza heurystykę po wyczerpaniu limitu. Testy: `test/candidatePool.test.js`
(8, w tym test akceptacyjny E2: limit 1 × 3 dni = 3 dopasowania, 0 strat).

## D-021 — Harmonogram: codzienne pobieranie o 12:00 czasu polskiego
**Data:** 2026-07-09
Na życzenie usera („codziennie koło 12 sprawdzać strony z przetargami") `TENDER_FETCH_CRON`
zmieniony z `0 */6 * * *` (co 6 h) na `0 12 * * *` (raz dziennie, południe). Zgodne
z modelem „agent dzienny → Dzisiejsze okazje" z `plans/MIGRACJA-AGENT-AI.md` §3.4/§11.
Dodano `SCHEDULER_TZ=Europe/Warsaw` — Railway chodzi w UTC, więc bez strefy „12"
odpalałoby o 13:00 (zima)/14:00 (lato). Strefa obejmuje też backup (03:00 teraz PL,
nie UTC). Harmonogram wydzielony do czystej `schedulerJobs()` z testami
(`test/scheduler.test.js`). Pobieranie obejmuje `pages: 2` (do ~1000 ogłoszeń/dzień).

## D-020 — Jeden model AI dla PrzetargAI: Claude Haiku 4.5 (przypięty)
**Data:** 2026-07-09
Na życzenie usera PrzetargAI używa JEDNEGO modelu — **Haiku 4.5** ($1/$5, batch $0,50/$2,50).
Zadania (ocena dopasowania, streszczenie ogłoszenia, ekstrakcja dokumentów) to
klasyfikacja/streszczanie — nie wymagają Opusa/Fable. Kontekst 200K mieści `htmlBody`
(~8K tok) z zapasem. Politykę egzekwuje **walidacja `AI_MATCH_MODEL` przy starcie**
(`config/env.js` → `process.exit(1)` gdy model spoza cennika) — fail-fast przy boot,
nie o 3 w nocy w cronie. `costUsd()` **rzuca** na nieznanym modelu zamiast cicho
wyceniać jak Haiku (dawny `DEFAULT_PRICING` = 5-krotne zaniżenie przy Opus, twardy
limit $500 odpalałby przy ~$2500 realnego wydatku).
**Cennik pozostaje współdzielony z Fitter Welder Pro:** `fitterScan.js` świadomie woła
Sonnet 4.6 (wizja: rysunki izometryczne) — cennik to tabela CEN, nie polityki, więc
Sonnet 4.6 zostaje w `MODEL_PRICING`. Przy okazji naprawiony **cichy bug produkcyjny**:
`fitterScan.js` wołał `costUsd({obj})` zamiast argumentów pozycyjnych → każdy skan ISO
księgowany jako **$0,00** od zawsze. Dodany `typeof model` guard + test regresyjny.

---

## D-018 — Stripe: cena Pro utworzona (app code jeszcze nie wspiera)
**Data:** 2026-05-24
Na życzenie usera utworzony produkt Stripe „PrzetargAI Pro" (`prod_UZt6PFJM9Yfm0O`)
i cena 399 PLN/mc (`STRIPE_PRICE_PRO=price_1TajKtAom97JfF2jKBWwGnKg`, TEST mode).
Częściowo nadpisuje D-001 — Pro był poza zakresem MVP. Sam obiekt Stripe nie
wystarczy do działania planu Pro w aplikacji; do pełnego wpięcia trzeba jeszcze:

1. migrację schematu (`users.premium_tier CHECK IN ('free','standard','pro')`),
2. logikę webhooka Stripe rozróżniającą plan po `price_id` sesji,
3. limity matchingu i powiadomienia dla Pro,
4. wybór planu w UI (obecnie sztywno kierujemy na Standard).

Bez tych kroków cena istnieje w Stripe, ale system nie potrafi jej obsłużyć.

## D-017 — Wdrożenie Railway przez GraphQL z Project Access Token
**Data:** 2026-05-23
Deploy zrealizowany przez Railway GraphQL API (`backboard.railway.com/graphql/v2`), nie przez CLI
ani dashboard UI. Powód: user dostarczył **Project Access Token** (nie Account Token).
CLI `railway whoami` z project tokenem zwraca `Unauthorized` (whoami żąda konta), ale wszystkie
operacje project-scoped (`serviceCreate`, `variableCollectionUpsert`, `volumeCreate`,
`serviceDomainCreate`, `serviceInstanceUpdate`, `serviceInstanceRedeploy`) działają bez przeszkód.
Header: `Project-Access-Token: <uuid>` (nie `Authorization: Bearer`).
Praktyczne: Python urllib trafia w Cloudflare 1010 z domyślnym UA `Python-urllib/3.x` —
trzeba `User-Agent: Mozilla/5.0` w nagłówkach. Curl i PowerShell `Invoke-RestMethod` nie mają tego problemu.
Schemat `VolumeCreate` zwraca `Volume`, który NIE ma pola `mountPath` w returnsie (mountPath jest w `VolumeInstance`).

## D-016 — Rezygnacja z osobnego landingu (mobile-only MVP)
**Data:** 2026-05-23
Backend serwuje wszystko, co kiedyś robił landing — zero Vercela, zero osobnej domeny.
Powód: MVP jest mobile-only; landing marketingowy = praca + koszt domeny + Vercel deploy bez
korzyści dla produktu, w którym jedyny kanał akwizycji to App Store / Play Store + outreach B2B.
Implementacja w `routes/upgrade.js`:
- `GET /` z `user_id` + `token` query params → consumuje magic link → tworzy Stripe Checkout
  → `res.redirect(303, session.url)`. Zastępuje statyczną stronę landingu, która kiedyś robiła to samo formularzem.
- `GET /success` + `GET /cancel` → minimalistyczne HTML (`<style>` inline, brand colors, mobile-first).
- Stripe `success_url`/`cancel_url` z `LANDING_URL` na `APP_URL`.
- `services/magicLink.js`: URL e-maila z `LANDING_URL` na `APP_URL`.
- `LANDING_URL` pozostaje w env declaration (deprecated, nieużywane) — można odzyskać gdy pojawi się landing.
Apple-compliant flow zachowany: aplikacja mobilna otwiera URL Stripe Checkout w przeglądarce
zewnętrznej; Stripe hostuje payment page; po płatności redirect na backend HTML „udane, wróć do apki".

## D-015 — Buildy mobilne przez Codemagic (nie EAS)
**Data:** 2026-05-21
Buildy iOS/Android realizuje Codemagic (`codemagic.yaml`), nie EAS Build —
zgodnie z narzędziami właściciela projektu. `eas.json` usunięty; EAS/Expo
służy wyłącznie do rejestracji projektu (`eas init`) dla tokenów push.
iOS wg sprawdzonych wzorców: trwały klucz RSA w grupie `ios_signing` (limit
certyfikatów Apple), code signing w skryptach (bez deklaratywnego bloku
`ios_signing:` powodującego „No matching profiles"), `export_options.plist`
generowany przez `xcode-project use-profiles`, `ITSAppUsesNonExemptEncryption=false`,
aplikacja iPhone-only (`supportsTablet:false`) — unika błędów walidacji iPad.
Android: podpis release wstrzyka skrypt do wygenerowanego `build.gradle`.

## D-014 — SQLite na trwałym wolumenie Railway
**Data:** 2026-05-21
System plików Railway jest ulotny — produkcyjnie baza SQLite musi leżeć na
zamontowanym wolumenie (`DATABASE_PATH=/data/data.db`). `BACKUP_DIR` domyślnie
trafia obok bazy, więc kopie też są na wolumenie. Szczegóły: `runbooks/deploy.md`.

## D-013 — Kopie zapasowe: AES-256-GCM + Backblaze B2
**Data:** 2026-05-21
Kopia zapasowa bazy: spójny snapshot przez `VACUUM INTO`, szyfrowanie
AES-256-GCM (klucz `BACKUP_ENCRYPTION_KEY`), format pliku
`[12 B IV][16 B authTag][szyfrogram]`. Zapis lokalny + wysyłka do B2
(natywne API v2). Brak kluczy B2 → kopia tylko lokalna (graceful degradation).
Retencja sterowana `BACKUP_RETENTION` (domyślnie 14 ostatnich kopii).

## D-012 — Mobile: React Navigation zamiast Expo Router
**Data:** 2026-05-21
Aplikacja mobilna (Expo SDK 54, React 19, RN 0.81) używa React Navigation
(native-stack) zamiast Expo Router. Powód: jawna, przewidywalna konfiguracja
stosów (auth ↔ aplikacja), łatwiejsza do weryfikacji. Token sesji trzymany
w `expo-secure-store`. Kod w czystym JS (spójnie z backendem).

## D-011 — Landing jako statyczny HTML/CSS/JS
**Data:** 2026-05-21
Landing page to statyczne pliki (bez frameworka), hostowane na Vercel.
Powód: zakres MVP landingu jest minimalny (cennik + checkout) — statyka jest
szybsza, niezawodna i wystarczająca. Przepływ płatności to czysty JS po stronie
klienta (`upgrade.js`). Strony `/upgrade/success` i `/upgrade/cancel` zgodne
z URL-ami zwracanymi przez backend.

## D-010 — Zweryfikowany endpoint API BZP
**Data:** 2026-05-20
Publiczny endpoint odczytu ogłoszeń BZP (bez uwierzytelniania):
`GET https://ezamowienia.gov.pl/mo-board/api/v1/notice`.
Parametry wymagane: `NoticeType` (=`ContractNotice`), `PublicationDateFrom`,
`PublicationDateTo`, `PageSize`, `PageNumber` (numeracja od 1).
Odpowiedź to tablica JSON. Pole `htmlBody` (duże, kilka–kilkadziesiąt KB)
jest usuwane przed zapisem do `tenders.raw_data`.

## D-009 — Graceful degradation usług zewnętrznych
**Data:** 2026-05-20
Backend uruchamia się i działa lokalnie nawet bez kluczy API (Stripe, Claude,
Resend, Fakturownia, Sentry). Brakująca usługa loguje ostrzeżenie i działa
w trybie ograniczonym (np. AI → scoring heurystyczny, email → log do konsoli).
**Powód:** umożliwia testowanie pełnego pipeline'u zanim człowiek uzupełni klucze.

## D-008 — Magic link TTL 10 minut, jednorazowy
**Data:** 2026-05-20
Token magic link do checkoutu: ważny 10 min, jednorazowy (`used_at`), tabela `magic_links`.

## D-007 — Pre-filtr heurystyczny przed AI
**Data:** 2026-05-20
Przed wywołaniem Claude przetargi są wstępnie filtrowane heurystyką (pokrycie słów
kluczowych i kodów CPV). AI ocenia tylko shortlistę kandydatów.
**Powód:** kontrola kosztów AI — bez tego każdy przetarg × każdy użytkownik = wywołanie AI.

## D-006 — Model AI: claude-haiku-4-5 do matchingu
**Data:** 2026-05-20
Scoring dopasowań używa Claude Haiku 4.5 (tani, szybki, wystarczający do oceny trafności).
Pricing skonfigurowany w `services/ai.js`; koszt zapisywany w `ai_usage`.

## D-005 — Rozszerzenie schematu users o profil firmy
**Data:** 2026-05-20
Minimalny schemat z briefu (user_id, nip, email, hash, tier) nie wystarcza do
matchingu. Dodano: `company_name`, `keywords` (JSON), `cpv_codes` (JSON),
`stripe_customer_id`, `stripe_subscription_id`, `push_token`.
**Powód:** dopasowanie przetargów wymaga kryteriów. Multi-profil pozostaje wycięty —
jeden profil na użytkownika.

## D-004 — Baza danych: node:sqlite zamiast better-sqlite3
**Data:** 2026-05-20
Użyto wbudowanego modułu `node:sqlite` (Node 24) zamiast `better-sqlite3`.
**Powód:** zero kompilacji natywnej → brak ryzyka błędu instalacji na Windows;
API niemal identyczne (DatabaseSync). Ostrzeżenie „experimental" wyciszone flagą
`--disable-warning=ExperimentalWarning` w skryptach npm.

## D-003 — Monorepo z podkatalogami backend/mobile/landing
**Data:** 2026-05-20
Zamiast płaskiej struktury z briefu — monorepo. `.env` jest po stronie backendu
(jedyny konsument); mobile i landing mają własne mechanizmy konfiguracji
(Expo / Vercel). Katalogi `data/`, `logs/` żyją wewnątrz `backend/`.

## D-002 — Strategia iOS: darmowe narzędzie B2B
**Data:** 2026-05-20
Aplikacja iOS bez zakupów w aplikacji (bez StoreKit). Subskrypcja przez przeglądarkę:
`przetargai.pl/upgrade?user_id={id}&token={magic_link}`. Omija 30% prowizji Apple.

## D-001 — Zakres MVP: tylko Free + Standard (199 zł)
**Data:** 2026-05-20
MVP obejmuje wyłącznie plan Free i Standard. Plan Pro (399 zł), multi-profil,
webhook API, asystent ofert, blog, AnalyzeScreen, dark mode, CI/CD (H14) — poza zakresem.
Mapowanie planów: free = 5 dopasowań/dobę bez push; standard = nielimitowane + push.
