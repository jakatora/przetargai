# Audyt i poprawki — 2026-09-29

Gałąź `integ/1.1.2` (worktree `D:/wt/przetargai-release`). Wszystko lokalnie: **bez push, deployu i publikacji**.
Checkout `D:\projekty\przetarg-ai` jest starszy (apka 1.0.9/vc9) i nie był ruszany.

## Co sprawdzono (etap 1, skrót)

- Produkcja (odczyt): Cloud Functions `/health` 200 (`api-00046-cem`, ~10 tys. otwartych przetargów, okna BZP/BK/wyników/planów bez błędów), Railway `/health` 200.
- Działało w przepływie web na emulatorze: logowanie i komunikaty błędów, feed z filtrami, szczegóły przetargu, zapis do „Zapisanych”, kalendarz terminów (termin pytań wg art. 284 ust. 2), hub Narzędzia (54 trasy, zero martwych celów).
- Nie sprawdzano: płatnego AI (analiza SWZ/umowy modelem), natywnego buildu Android/iOS, płatności, prawdziwych pushy.

## Zmiany (etap 2)

1. **Bezpieczne środowisko lokalne** (`firebase/functions/src/config.js`, `.secret.local`, skrypty npm, `smoke.sh`, `test/emulator.js`).
   Emulator i testy działają na projekcie `demo-przetargai`. `.secret.local` trzyma niepuste **atrapy** wszystkich 9 sekretów, bo firebase-tools dla braku albo pustej wartości sięga do Secret Managera. W trybie lokalnym most jest domyślnie wyłączony i skierowany na `127.0.0.1:3100`, a jawne włączenie na inny host kończy się błędem konfiguracji. W emulatorze AI, Stripe, e-mail, faktury i push są wyłączone bez względu na klucze. Produkcja zachowuje dotychczasowe domyślne (test to sprawdza). Testy mostu włączają go jawnie, na atrapę na loopback.
2. **Nawigacja po logowaniu** (`RootNavigator`, `lib/onboarding.js`). Nawigator dostaje `key` sesji. Wcześniej router tworzony raz z trasą `Login` po zalogowaniu spadał na pierwszy ekran grupy, czyli `Witaj`. Dodatkowo wylogowanie działa na webie: `Alert.alert` w react-native-web jest pusty, więc użyto `lib/potwierdzenie.js` z `window.confirm`.
3. **SWZ → konkretny przetarg → checklista.**
   - Nowe trasy `GET/PUT/DELETE /wygrywalnosc/tender/:id/swz`. Powiązanie zapisuje się w `users/{uid}/powiazania_swz/{tenderId}`, po sprawdzeniu przez most, że analiza należy do użytkownika (cudza → 404). Usuwane razem z kontem.
   - Ekran checklisty ma sekcję „Analiza SWZ tego przetargu”: wybór własnej analizy, zmianę i odłączenie. Wymagania pochodzą z prawdziwego pola `wymagane_typy` z `POST /api/przetarg/sejf/dopasowanie/:id` (deterministyczny parser, bez AI), a nie z `checklista` Radaru, która jest listą zmian SWZ.
   - Brak powiązania, błąd pobrania, nieznany format albo brak wymagań oznacza, że gotowość jest nieustalona i nigdy „gotowe”.
4. **Sejf** (`SejfScreen`, `lib/sejf.js#stanListySejfu`). Błąd pobrania jest oddzielony od błędów akcji i ma przycisk „Ponów”. Komunikat „Sejf jest pusty” pojawia się tylko po udanym pobraniu pustej listy, a chwilowy błąd nie ukrywa wcześniej pobranych dokumentów.
5. **Funkcja A — przypomnienie o terminie pytań do SWZ.**
   - Pliki: `jobs/przypomnieniaPytanSwz.js` i `lib/przypomnieniePytan.js`, wywoływane z `remindDeadlines` co 6 h (Europe/Warsaw).
   - Termin pochodzi z istniejącego `lib/kalendarzPrzetargu.js` (BZP −4 dni, TED −14 dni). Baza Konkurencyjności albo brak terminu oznacza brak wysyłki; nie dodano nowych reguł prawnych.
   - Jedno powiadomienie w ostatniej dobie przed terminem. Rezerwacja w transakcji przed wysyłką, więc powtórka ani równoległy przebieg nie dublują pusha. Błąd dostawcy prowadzi do ponowienia, najwyżej 3 próby. **Ograniczenie:** jeśli proces padnie po przyjęciu pushu przez Expo, a przed zapisem „wyslane”, rezerwacja po 30 min jest uznawana za osieroconą i push może pójść drugi raz. Expo Push API nie ma klucza idempotencji — to „najwyżej jeden przy powtórkach i równoległych przebiegach”, nie absolutne „dokładnie raz”.
   - Przypomnienie idzie tylko przy włączonym przełączniku „Przypomnij przed terminem”. Treść jest po polsku, z godziną warszawską. Push prowadzi do Kalendarza z podświetlonym terminem pytań.
   - Nowy indeks złożony `saved(reminder_enabled, tender_deadline)`.
6. **Znalezione przy weryfikacji: most gubił ciało POST/PATCH.** Runtime Functions (i emulator) parsuje żądanie przed aplikacją, a most przekazywał `req.body` zamiast `req.rawBody`. W emulatorze dodanie do Sejfu i utworzenie analizy SWZ dawały 400. **Na produkcji prawdopodobnie tak samo — niezweryfikowane.** Poprawka jest w `routes/most.js`, z testem odtwarzającym runtime.
7. **Konfiguracja testów:** `backend/.env.test` z atrapami (`JWT_SECRET`, klucz szyfrowania kopii, puste klucze usług). Smoke i emulator używają spójnego klucza admina.

## Wyniki testów — etap 2 (ostatni PEŁNY zestaw, przed korektą z etapu 3)

| Zestaw | Wynik |
|---|---|
| Functions (`npm test`, emulator Firestore, JDK 21) | **1244/1244** |
| Smoke E2E (`npm run test:e2e`) | **29/29**, 0 prób dostępu do Secret Managera |
| Mobile (`npm test`) + esbuild `check` | **1060/1060**, check czysty |
| Backend Railway (`npm test`) | **1026/1026** (przed zmianą: bez `.env` 521/579 — 58 FAIL środowiska; z samym JWT 1022/1026) |
| Końcowy web-flow (Chrome, emulator + lokalny Railway) | **14/14 kryteriów PASS** |

Web-flow: przeglądarka zablokowała i zalogowała **0** żądań poza maszynę, lokalny Railway **0** prób wyjścia na zewnątrz. Emulator: **0** prób dostępu do sekretów. Most był skierowany jawnie na `127.0.0.1:3100` przez tymczasowy `.env.local`, usunięty po przebiegu.

Dowody (poza repo): `D:\wt\dowody-przetargai-2026-09-29\` — zrzuty `01…11-*.png`, `web-flow-log.txt`, `railway-lokalny-log.txt`.

## Checklista odbioru

- [x] Emulator bez mostu na produkcję i bez produkcyjnych sekretów (`test/srodowiskoLokalne.test.js`, smoke: 0 prób dostępu do sekretów).
- [x] Login z gotowym profilem trafia do feedu, nowe konto do onboardingu, wylogowanie i ponowny login nie zostawiają starego stosu (test routera + web-flow 2a–2d).
- [x] Powiązanie SWZ ↔ przetarg: trwałe, w zakresie użytkownika i przetargu. Cudza analiza daje 404, a checklista pokazuje brakujące, nieaktualne i posiadane dokumenty (testy + web-flow 3a–3f).
- [x] Sejf: błąd pobrania to nie pusty sejf; „Ponów” działa; dane zostają przy chwilowym błędzie (web-flow 4a–4d).
- [x] Przypomnienie o pytaniach do SWZ: jedno w oknie 24 h przy powtórzonych i równoległych przebiegach (z ograniczeniem opisanym wyżej), błąd dostawcy to nie sukces, preferencja jest respektowana, strefa Europe/Warsaw; tylko testowy dostawca.
- [x] Checklista nie twierdzi o komplecie na danych z parsera fraz (etap 3).
- [x] Oba przebiegi przypomnień niezależne (etap 3).
- [x] Okna potwierdzeń i komunikaty w Koncie, Sejfie i Rejestratorze działają na webie (etap 3).
- [ ] Wydanie: deploy Functions **razem z indeksami** (`firebase deploy --only functions,firestore:indexes`), nowy build mobile (nawigacja, Sejf, checklista, wylogowanie web). Railway bez zmian w kodzie.

## Pozostałe ograniczenia

- Natywnego buildu, płatnego AI (analiza SWZ modelem) ani prawdziwego pushu nie uruchamiano.
- Poprawka ciała mostu jest potwierdzona w emulatorze. Na produkcji wymaga deployu i sprawdzenia na prawdziwym koncie.
- Poza Kontem, Sejfem i Rejestratorem inne ekrany mogą nadal używać `Alert.alert` (na webie niewidoczny) — poza zakresem tej korekty.
- Lista wymaganych dokumentów pochodzi z parsera fraz SWZ: to pomoc, nie komplet. Checklista mówi to wprost, ale nie wykryje wymagań opisanych nietypowo.
- Wszystkie analizy SWZ użytkownika są dostępne do powiązania; tworzenie analizy prosto z karty przetargu (auto-powiązanie) nie jest zrobione.
- Na produkcji tygodniowy digest trafia co tydzień do kont testowych `qa-/qa2-/chk-…@test.pl` i odbija się (Resend: `bounced`). Kont nie ruszano — do decyzji właściciela.

## Etap 3 — korekta po niezależnym przeglądzie (CHANGES_REQUIRED)

Druga sesja Claude wskazała cztery problemy. Wszystkie poprawiono w osobnym commicie:

1. **Fałszywa pełna gotowość.** `wymagane_typy` pochodzi z parsera fraz (`wykryjWymaganeTypy`). SWZ wymagająca KRS, US i ZUS innymi słowami dawała tylko KRS, a ekran mówił „Wszystkie obowiązkowe dokumenty są ważne”.
   - Teraz dla wymagań z parsera (`znane`) nie ma tonu sukcesu ani twierdzenia o komplecie.
   - Komunikat: „Dokumenty wykryte automatycznie (N) są ważne… To pomoc, nie potwierdzenie kompletności — sprawdź pozostałe wymagania SWZ” albo „X rzeczy do załatwienia spośród N wykrytych automatycznie. Lista może być niepełna…”.
   - Pod analizą stała uwaga o liczbie wykrytych. Stany nieznany i błąd pozostają nieustalone.
   - Na ekranie nie ma innego nagłówka, badge'a ani procentu gotowości.
   - Test behawioralny przepuszcza przykład przez prawdziwy parser Railway, mapowanie w aplikacji, checklistę Functions i komunikat; do tego regresja dla pustych i błędnych danych.
2. **Niezależne przypomnienia.** `jobs/harmonogramPrzypomnien.js` uruchamia oba przebiegi przez `Promise.allSettled`. Wyjątek któregokolwiek daje `ok:false`, handler rzuca, a Scheduler ponawia. Test zachowania obejmuje 4 przypadki (pierwszy rzuca, drugi rzuca, oba OK, oba FAIL).
3. **Okna na webie.** `lib/potwierdzenie.js` ma `potwierdzAkcje`, `wybierzOpcje` i `pokazKomunikat`, a `services/srodowiskoPotwierdzen.js` dostarcza środowisko.
   - Podpięte: usuwanie konta, rezygnacja z subskrypcji, usuwanie dokumentu w Sejfie (`window.confirm`) oraz wybór typu awarii w Rejestratorze (na webie przyciski w treści ekranu).
   - Komunikaty jednoprzyciskowe (np. błędy) w tych trzech ekranach idą przez `window.alert`.
   - Sens akcji bez zmian.
4. **Uczciwość raportu:** ograniczenie idempotencji opisane w punkcie 5 i w kodzie joba.

**Testy po korekcie** (celowane, bez ponownego pełnego zestawu Functions):
- Mobile: pełny `npm test` **1068/1068**, `check` czysty.
- Functions: pliki harmonogramu, przypomnień, push, izolacji, indeksów i sekretów — **94/94** (14 plików).
- Izolowany web-flow po korekcie (świeży bundle): **7/7 PASS** — częściowa detekcja bez „wszystkie obowiązkowe”, braki spośród wykrytych, `confirm` przy usuwaniu dokumentu w Sejfie i dokument znika z listy.
- Izolacja w tym przebiegu: 0 żądań poza maszynę, 0 prób dostępu do sekretów, 0 wyjść lokalnego Railway.
- Dowody: `D:\wt\dowody-przetargai-2026-09-29-korekta\`. Zrzuty z etapu 2 pokazują stan sprzed korekty.

## Incydent testowy (etap 1, 2026-09-29, bez sekretów)

Audytowy przebieg na emulatorze (projekt `przetargai`, bez `.secret.local`) spowodował:

1. firebase-tools pobrał wszystkie 9 sekretów z Secret Managera **do lokalnych procesów emulatora**. Nigdzie ich nie wypisano ani nie zapisano.
2. Rejestracje testowe wysłały przez produkcyjny Resend **10 maili powitalnych** na adresy `@test.pl` (29.09, 17:50–17:59 UTC). Wszystkie mają status `bounced` — nie doręczono ich nikomu.
3. Otwarcie Sejfu przez most założyło **1 konto pomostowe** na produkcyjnym Railway. Konto usunięto produktową ścieżką RODO (`DELETE /auth/me` → `usunKontoPomostowe`): mapowanie przez 409→login potwierdziło, że to samo konto; Railway zwrócił sukces, log `wynik: usuniete`. Sejf konta był pusty. Innych kont nie kasowano.
   - Niezależne potwierdzenie z zewnątrz wymagałoby produkcyjnego sekretu albo klucza admina — celowo tego nie robiono.

Przyczyna i zabezpieczenie: zmiany z punktu 1, pilnowane przez `test/srodowiskoLokalne.test.js`.
