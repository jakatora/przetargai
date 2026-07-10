# PrzetargAI → Osobisty Agent AI dla JDG i małych wykonawców

**Dokument architektoniczny migracji.** Status: PROPOZYCJA — do akceptacji przed implementacją.
Data: 2026-07-09. Autor: architekt produktu / senior dev.

Zasada nadrzędna: **ewolucja, nie przepisywanie.** Zachowujemy Express 5 + `node:sqlite`,
warstwy `routes → services → repos`, pobieranie z BZP, Stripe + magic link, React Native + Expo,
oraz dwustopniowy silnik dopasowań (heurystyka jako pre-filtr, Claude jako sędzia).
Wszystkie zmiany są addytywne albo lokalne.

---

## 1. Analiza obecnego stanu

### 1.1 Co jest (zweryfikowane uruchomieniem, nie z lektury)

| Warstwa | Stan |
|---|---|
| Backend | Node 22+, Express 5, `node:sqlite`, Zod 4, pino. Testy **16/16 PASS** |
| Mobile | RN 0.81 + Expo SDK 54, New Arch. Bundle **973 moduły / 2.43 MB**, build czysty. `expo-doctor` 17/18 |
| BZP | Żywy pobór: **500 ogłoszeń w 4,07 s** |
| API E2E | rejestracja 201, duplikat 409, zły NIP 400, złe hasło 401, brak tokenu 401, feed, feedback, IDOR→404 |
| Płatności | magic link (10 min, jednorazowy) → `GET /upgrade` → 303 na Stripe Checkout → webhook podnosi `premium_tier` |
| Degradacja | `features.{ai,stripe,email,invoicing,sentry,backups}` z obecności kluczy — brak klucza = wyłączona usługa, nie crash |

### 1.2 Architektura domenowa (bez zmian)

```
cron 6h → jobs/fetchTenders.js
            ├─ services/bzp.js      (GET /mo-board/api/v1/notice)
            ├─ tenders.upsert
            └─ dla każdego usera:
                 services/matching.js
                   ├─ lib/scoring.js  → heurystyka (tanio)
                   └─ services/ai.js  → Claude Haiku (tylko gdy heurystyka ≥ 15)
                 → matches.create → push (tylko Standard)
```

### 1.3 Backend jest monolitem wielo-projektowym

Ten sam proces i ta sama baza obsługują **Fitter Welder Pro**: tabele `fitter_premium`,
`fitter_chat_message`, `fitter_job_listing`, trasy `/api/fitter/*`. Pięć ostatnich commitów
dotyczy wyłącznie Fittera. **Konsekwencja dla migracji:** każda zmiana `schema.sql` i
webhooka Stripe musi być bezpieczna dla Fittera. Nie ruszamy jego tabel.

---

## 2. Problemy obecnego rozwiązania

### 2.1 KRYTYCZNE — silnik dopasowań gubi trafne przetargi

Zmierzone na 500 prawdziwych ogłoszeniach z BZP.

**P-1. Dopasowanie CPV widzi tylko pierwszy kod.**
BZP zwraca `cpvCode` jako sklejony łańcuch:
`"45000000-7 (Roboty budowlane),45100000-8 (...),45233120-6 (Roboty w zakresie budowy dróg)"`.
`lib/scoring.js:32` robi `replace(/\D/g,'')` na **całym** stringu, sklejając wszystko w jeden ciąg
cyfr, po czym sprawdza `startsWith(prefix)`. Liczy się wyłącznie pierwszy kod (z cyfrą kontrolną).

- **70,8%** ogłoszeń (354/500) ma wiele kodów CPV.
- Firma z CPV `45233000`: **95** przetargów zawiera kod `45233*`, heurystyka rozpoznaje **49**.
  → **46 trafnych przetargów (48%) jest niewidocznych.**

**P-2. Słowa kluczowe nie znają polskiej fleksji.**
`haystack.includes(kw)` to zwykły substring. User wpisuje „droga", BZP pisze „drogi", „drogę", „dróg".

- 57 tytułów zawiera rdzeń `drog`, tylko **5** zawiera dosłownie `droga`.
  → słowo kluczowe „droga" **pomija 52 przetargi drogowe (91%)**.

**P-3. P-1 i P-2 po cichu wyłączają AI.**
`AI_PREFILTER_MIN = 15`. Gdy heurystyka da 0, `matching.js` zwraca wynik heurystyczny i
**nigdy nie woła Claude'a**. Przetarg drogowy z CPV `45233120` na drugiej pozycji nie dostanie
nawet szansy oceny przez model. Naprawa P-1 i P-2 jest warunkiem koniecznym, by AI działało.

**P-4. Konta Free bezpowrotnie tracą przetargi.**
`runTenderFetch` przekazuje do matchingu wyłącznie `newTenderRecords` z bieżącego przebiegu.
`generateMatchesForUser` robi `break`, gdy wyczerpie dzienny limit 5. Pominięte przetargi
nie mają wiersza w `matches`, ale w kolejnym cyklu **nie są już „nowe"** → nigdy nie zostaną
ponownie ocenione. Przy 500 ogłoszeniach naraz free user widzi 5, a 495 przepada na zawsze.

### 2.2 KRYTYCZNE — brak mechanizmu migracji bazy

`db/migrate.js` = `db.exec(schema.sql)` gdzie schema to same `CREATE TABLE IF NOT EXISTS`.
`schema_meta.version` jest **zapisywany, ale nigdy nie czytany ani porównywany**.
**Nie da się dziś dodać kolumny do istniejącej tabeli ani zmienić `NOT NULL`.**
To blokuje całą tę migrację. Runner migracji jest pierwszym zadaniem, przed czymkolwiek innym.

### 2.3 Model produktu nie pasuje do persony

| Element | Dziś | Dla JDG / małego wykonawcy |
|---|---|---|
| Rejestracja | NIP obowiązkowy, walidacja sumy kontrolnej | Bariera na wejściu. JDG często nie zna CPV ani nie chce podawać NIP-u „na próbę" |
| Profil | `keywords` + `cpv_codes` (surowe kody) | Nikt nie wie, że szuka `45233120-6`. Myśli: „układam kostkę brukową" |
| Feed | `ORDER BY created_at DESC, score DESC` — chronologia przed jakością | Persona chce **5 najlepszych okazji dziś**, nie 500 ogłoszeń |
| Uczenie się | Tabela `feedback(helpful)` zapisywana i **nigdzie nieużywana** | Agent musi się uczyć |
| Lokalizacja | Brak | Kluczowa: JDG nie pojedzie 400 km |
| Wartość | `budget` = `null` w **100%** (0/500) | Kluczowa: JDG nie startuje w przetargu za 40 mln |

### 2.4 Dług poboczny (nie blokuje, ale ciąży)

- `landing/` to martwy kod (D-016 zlikwidował landing). Jego dokumenty prawne mają
  **niewypełnione placeholdery** `[PEŁNA NAZWA FIRMY]`, `[ADRES]` — ryzyko compliance,
  gdyby ktoś to wdrożył. Dokumenty prawne istnieją w 3 kopiach (`docs/` = te w App Store, backend, landing).
- **Zero testów tras.** Otestowane tylko czyste funkcje. Auth, guardy IDOR, limity, webhook — bez testów.
- Strony `/upgrade/*` serwowane przez backend to ślepe zaułki (0 linków, 0 przycisków), brak deep linku `przetargai://`.

### 2.5 Defekty UI i dostępności (znalezione przy uruchomieniu apki, 2026-07-09)

Aplikacja uruchomiona w przeglądarce (Expo web) i sterowana Playwrightem, na 500 realnych
ogłoszeniach z BZP. Wszystkie przepływy działają: logowanie, feed, szczegóły, feedback (200 OK),
zapis profilu (200 OK), odtworzenie sesji po przeładowaniu. Znalezione defekty:

| # | Defekt | Dowód |
|---|---|---|
| **U-1** | **Zero dostępności.** `Button` (Pressable) nie ma `accessibilityRole="button"`, `TextField` nie ma `accessibilityLabel` na `TextInput` | W DOM: **0** elementów z rolą przycisku, **0** pól z powiązaną etykietą. Dotyczy też natywnego Androida/iOS — TalkBack i VoiceOver nie ogłoszą tych elementów |
| **U-2** | **„Kod CPV"** renderuje surowy sklejony łańcuch na 4 linie | `45000000-7 (Roboty budowlane),45233200-1 (Roboty w zakresie różnych nawierzchni),45233222-1 (…)` |
| **U-3** | **Odznaka wyniku nieczytelna.** W kwadracie 54×54 px napis „% dopasowania" ma **8 px** i łamie się na dwie linie | Zmierzone: dziecko `54×22 px`, `font-size: 8px` |
| **U-4** | **Fałszywe trafienie** — „Przebudowa gabinetów lekarskich, łazienek" dostaje **80%** dla brukarza | Słowo kluczowe `budowa` jest podciągiem `Przebudowa`. Naiwny substring tnie w obie strony: P-2 gubi trafne, U-4 wpuszcza nietrafne |
| **U-5** | Tabela `feedback` zapisuje się i **nikt jej nie czyta** | Po kliknięciu „👍 Trafne": 1 wiersz w bazie, zero wpływu na cokolwiek |
| **U-6** | `config.js` w DEV na web uderzał w **produkcyjny backend Railway** (`hostUri` bywa `undefined`) | Naprawione fallbackiem na `location.hostname` |
| **U-7** | `headerBackTitleVisible` — opcja usunięta w React Navigation 7 | Ostrzeżenie w konsoli |
| **U-8** | `expo@54.0.34`, oczekiwane `~54.0.35` | `expo-doctor` 17/18 |

U-1, U-3 i U-2 są tanimi poprawkami, a wchodzą w zakres nowego dashboardu (sekcja 8) — warto
zrobić je przy okazji E9, nie osobno.

---

## 3. Co BZP naprawdę daje — twarde ograniczenia danych

**To jest najważniejsza sekcja tego dokumentu.** Zweryfikowana na żywym API (300–500 ogłoszeń).

### 3.1 Pola dostępne w `ContractNotice`

```
clientType  orderType  tenderType  noticeType  noticeNumber  bzpNumber
isTenderAmountBelowEU  publicationDate  orderObject  cpvCode
submittingOffersDate  procedureResult  organizationName
organizationCity  organizationProvince  organizationCountry
organizationNationalId  organizationId  tenderId  contractors  objectId
htmlBody (≈27 KB, pełna treść ogłoszenia)
```

| Wymiar z Twojej specyfikacji | Dostępność | Źródło |
|---|---|---|
| CPV | ✅ pełna lista | `cpvCode` (rozbić po przecinku) |
| Słowa kluczowe | ✅ | `orderObject` + `htmlBody` |
| Branża | ✅ | `orderType` = `Works` / `Services` / `Delivery` (133/87/80) |
| Województwo | ✅ deterministycznie | `organizationProvince` = `PL` + kod TERYT |
| Promień działania | ⚠️ wymaga geokodowania | `organizationCity` + własna tablica miast → lat/lon |
| Typ zamawiającego | ⚠️ wymaga słownika | `clientType` (kod `1.1.2`, `1.1.5`…) |
| Termin realizacji | ⚠️ tylko z `htmlBody` | `4.2.10.) Okres realizacji zamówienia albo umowy ramowej: 100 dni` |
| **Min/max wartość przetargu** | ❌ **NIE ISTNIEJE** | patrz niżej |

Mapowanie `organizationProvince` potwierdzone: `PL02`→dolnośląskie (Jelenia Góra),
`PL04`→kujawsko-pomorskie (Grudziądz), `PL08`→lubuskie (Gorzów Wlkp.), `PL10`→łódzkie (Łódź),
`PL12`→małopolskie (Bochnia), `PL14`→mazowieckie (Karczew), `PL16`→opolskie (Kietrz).
16 wartości, tablica statyczna.

### 3.2 Wartość zamówienia — problem i rozwiązanie

**Fakt:** w ogłoszeniu o zamówieniu **nie ma żadnego pola z kwotą**. Ani w JSON (jedyne pole
pieniężne to `isTenderAmountBelowEU`, które ma wartość `true` dla **300/300** — nic nie różnicuje),
ani w `htmlBody` (brak fraz „wartość", „szacunkowa"). Zamawiający krajowi poniżej progu UE
nie mają obowiązku publikować wartości szacunkowej w ogłoszeniu.

**Ale:** ogłoszenia o wyniku (`TenderResultNotice`) zawierają kwoty w **6/6** sprawdzonych:
```
4.3.1) Wartość zamówienia stanowiącego przedmiot tego postępowania (bez VAT): 49400 PLN
8.2.) Wartość umowy/umowy ramowej: 547542,00 PLN
```

**Rekomendacja (D-020):** filtr min/max wartości realizujemy jako **estymator**, nie jako
twardy filtr na danych źródłowych.

1. Nowy job `jobs/fetchResults.js` pobiera `TenderResultNotice`, parsuje kwoty z `htmlBody`,
   zapisuje do `tender_value_stats` klucz `(cpv_division, order_type, province)` →
   `n, median, p25, p75`.
2. Dla żywego ogłoszenia liczymy `value_estimate` = mediana z najbardziej szczegółowego
   dostępnego klucza, plus `value_confidence` ∈ [0,1] z liczby próbek
   (`conf = n / (n + 10)`, czyli n=10 → 0,5; n=90 → 0,9).
3. W UI **zawsze** pokazujemy to jako szacunek: *„Szacowana wartość ok. 120 tys. zł
   (na podstawie 47 podobnych zamówień)"*. Nigdy jako fakt.
4. Gdy `value_confidence < 0.3` → komponent wartości w scoringu jest **neutralny (0,5)**,
   nie karze przetargu.

**Decyzja do akceptacji:** zgadzasz się, że „minimalna/maksymalna wartość przetargu" będzie
działać jako **filtr miękki na szacunku**, a nie twardy filtr na kwocie? Alternatywa to
usunięcie tego kryterium z produktu — bo danych po prostu nie ma.

### 3.3 Dodatkowy sygnał, którego nie było w specyfikacji

**20% ogłoszeń (24/120) jest podzielonych na części** (`Część 1`, `Część 2`…).
Przetarg podzielony na części jest **znacznie dostępniejszy dla JDG** — można startować
do jednej części. To silny sygnał dla persony i proponuję go dodać jako `parts_count`
oraz bonus w scoringu.

### 3.4 Jedno pobranie, wiele dopasowań

Zasada, którą trzeba utrzymać przy każdej zmianie: **nie przeszukujemy sieci per użytkownik.**
Tak jest już dziś i tak zostaje:

```text
cron co 6h ──▶ runTenderFetch()                     JEDNO pobranie z BZP
                 └─ searchNotices()                 (jedyne miejsce wołania sieci)
                 └─ tenders.upsert()                zapis do wspólnej bazy
                       │
                       ▼
               for (user of users.all())            N dopasowań z BAZY, nie z sieci
                 └─ generateMatchesForUser()
```

`searchNotices()` jest wołane wyłącznie z `runTenderFetch` (`jobs/fetchTenders.js:97`).
Żadna trasa HTTP ani żadne konto nie odpala pobierania. Rejestracja i `PATCH /auth/me`
też mają korzystać z bazy (`tenders.recent()`), nigdy z sieci.

**Co JEST per użytkownik:** ocena AI (`evaluateMatch` → Claude dla pary user × przetarg).
To nieusuwalne — nie da się zrankować przetargu dla kogoś bez znajomości jego profilu.
Dlatego pipeline 3-etapowy (sekcja 5.1) zamyka to stałym sufitem N wywołań na konto,
a najdroższa praca (czytanie 27 KB `htmlBody`) jest **współdzielona** w `tender_analysis`.

### 3.5 Architektura źródeł — dziś jedno, docelowo kilka

Dziś jedynym źródłem jest krajowy BZP (`ContractNotice`, poniżej progu UE). Dla persony JDG
to źródło właściwe — tam są małe zamówienia. Ale „strony z przetargami" to liczba mnoga i warto
przygotować na to strukturę **zanim** dojdzie drugie źródło.

**Zmiana:** `services/bzp.js` → `services/sources/bzp.js`, z kontraktem:

```text
services/sources/index.js     rejestr aktywnych źródeł
services/sources/bzp.js       BZP — ogłoszenia o zamówieniu   (jest)
services/sources/bzpResults.js BZP — ogłoszenia o wyniku       (E11, kwoty + kto wygrał)
services/sources/ted.js       TED — progi unijne              (P2, zwykle za duże dla JDG)
services/sources/platformy.js platformazakupowa.pl, eb2b, …   (P2, wymaga scrapingu)
```

Każde źródło eksportuje `fetch({ from, to })` i zwraca ogłoszenia w **jednym, wspólnym kształcie**
(ten sam, który dziś produkuje `normalizeNotice`). `runTenderFetch` iteruje po źródłach i robi
`tenders.upsert()` — deduplikacja po `bzp_external_id` (przemianować na `external_id` + `source`).

**Wymagana zmiana schematu:** `tenders.source TEXT NOT NULL DEFAULT 'bzp'` oraz
`UNIQUE (source, external_id)` zamiast `UNIQUE (bzp_external_id)`. Migracja `003`.

**Uwaga o zakresie.** Portale zakupowe (`platformazakupowa.pl`, `eB2B`, `SmartPZP`) nie mają
publicznego API — to scraping HTML, kruchy i wymagający utrzymania. Zanim tam pójdziemy, warto
sprawdzić, ile z nich publikuje **równolegle** w BZP: ustawowo ogłoszenie o zamówieniu krajowym
**musi** trafić do BZP. Podejrzewam, że pokrycie BZP jest bliskie 100% dla naszej persony,
a portale dokładają głównie dokumentację, nie nowe ogłoszenia. **To jest pomiar do zrobienia
przed decyzją**, nie założenie — inaczej zbudujemy kruchy scraper bez zysku.

---

## 4. Wizja produktu

> **Nie wyszukiwarka. Agent.**
> Użytkownik nie szuka. Użytkownik dostaje rano listę okazji i decyduje: biorę / nie biorę.
> Agent uczy się z tych decyzji.

**Persona:** Marek, 41 lat, JDG, brukarstwo i drobne roboty ziemne. Promień 60 km od Kielc.
Bierze zlecenia 30–250 tys. zł. Nie zna kodów CPV. Nie ma czasu przeglądać BZP.
Otwiera telefon o 7:00 przy kawie i chce zobaczyć **trzy** rzeczy warte jego uwagi.

**Zmiana obietnicy:**
- było: *„Monitoring przetargów publicznych dla Twojej firmy"*
- będzie: *„Twój agent codziennie znajduje przetargi, w których masz szansę wygrać"*

**Trzy filary:**
1. **Zero konfiguracji technicznej.** Bez NIP, bez CPV. Mówisz co robisz i gdzie — reszta to nasza robota.
2. **Kurator, nie katalog.** Dziennie 3–10 pozycji z uzasadnieniem, nie 500 z paginacją.
3. **Agent się uczy.** Każde otwarcie, zapisanie, ukrycie zmienia jutrzejszy ranking.

### 4.4 Model cenowy (DECYZJA PODJĘTA)

Dotychczasowy cennik (Standard 199 zł, Pro 399 zł) **zostaje zastąpiony w całości**.
Ceny 199 i 399 archiwizujemy w Stripe. Brak żywych subskrybentów (TEST mode) → zero migracji klientów.

**Oś różnicowania:** plan pierwszy **znajduje** przetargi. Plan drugi **czyta je za Ciebie**.
To nie jest sztuczne dzielenie limitami — to dwie różne prace, o różnym koszcie po naszej stronie.

| | **Zwiad** (Free) | **Solo** — 49 zł netto/mc | **Ekspert** — 99 zł netto/mc |
|---|---|---|---|
| **Obietnica** | Zobacz, co agent potrafi | Agent znajduje okazje | Agent czyta ogłoszenia i ocenia szanse |
| Okazje dziennie | 3 | do 10 | do 10 |
| AI re-rank | top 3 | top 30 | top 60 |
| Uzasadnienie dopasowania | ✅ 1 zdanie | ✅ 1 zdanie | ✅ rozszerzone |
| Alerty natychmiastowe (≥90%) | ❌ | ✅ | ✅ |
| Zapisywanie + przypomnienia o terminach | 5 pozycji | ∞ | ∞ |
| **Agent uczy się z zachowań** | ❌ | ✅ | ✅ |
| Filtry (promień, województwa, wartość, próg) | ❌ | ✅ | ✅ |
| Szacowana wartość | ❌ | ✅ | ✅ + przedział p25–p75 |
| **Streszczenie ogłoszenia AI** (5 punktów z 27 KB) | ❌ | ❌ | ✅ |
| **Wymagane dokumenty i warunki udziału** | ❌ | ❌ | ✅ |
| **„Czy się kwalifikuję?"** — AI vs Twój profil | ❌ | ❌ | ✅ |
| **Kto wygrywał podobne, za ile, ilu startowało** | ❌ | ❌ | ✅ |
| Eksport (CSV, terminy do iCal) | ❌ | ❌ | ✅ |
| Profile branżowe | 1 | 1 | 3 |

**Dlaczego akurat tak przebiega granica.** Funkcje planu Ekspert opierają się na dwóch źródłach,
które istnieją w BZP, ale są kosztowne w obróbce:

1. `htmlBody` (~27 KB na ogłoszenie) — pełna treść z warunkami udziału i wykazem dokumentów.
   To jest te 40 stron, których JDG nie czyta. AI streszcza je do 5 punktów i wypisuje,
   czego wymaga zamawiający. **Realna oszczędność godziny czytania na każdym przetargu.**
2. `TenderResultNotice` — kwoty + pole `contractors`. Stąd „tę drogę wygrał X za 340 tys.,
   startowało 4 wykonawców". **Przewaga informacyjna, której nie da żadna wyszukiwarka.**

Plan Solo nie płaci za tę obróbkę i dlatego może kosztować 49 zł.

### 4.5 Koszt i marża (Haiku 4.5: $1/M wej., $5/M wyj.; kurs 4,1 zł/$)

| Plan | Koszt AI / user / mc | Prowizja Stripe | Przychód | **Marża brutto** |
|---|---:|---:|---:|---:|
| Zwiad | ~0,8 zł | — | 0 zł | — (koszt akwizycji) |
| **Solo** | ~8,4 zł | ~1,7 zł | 49 zł | **~38,9 zł (79%)** |
| **Ekspert** | ~17,9 zł | ~2,4 zł | 99 zł | **~78,7 zł (79%)** |

Ekspert: re-rank 60/dzień ≈ $4,10/mc + analizy ogłoszeń on-demand.
Analiza jednego ogłoszenia ≈ 8 000 tok. wej. + 600 wyj. ≈ **$0,011**.

**Kluczowa optymalizacja:** streszczenie ogłoszenia jest **niezależne od użytkownika**, więc
`tender_analysis` jest **współdzieloną pamięcią podręczną** — pierwszy Ekspert, który otworzy
ogłoszenie, płaci za analizę; każdy kolejny dostaje ją z bazy za darmo. Przy rosnącej bazie
użytkowników koszt krańcowy tej funkcji dąży do zera. Tylko werdykt „czy się kwalifikuję"
jest per-user (≈ $0,003, bo dostaje już gotowe streszczenie zamiast 27 KB HTML).

**Zabezpieczenia kosztowe:** analizy generujemy **leniwie** (dopiero gdy user otworzy szczegóły),
nigdy hurtem dla 500 ogłoszeń. Limit 50 analiz/mc na konto Ekspert. Istniejący budżet
`AI_BUDGET_SOFT_USD` / `HARD_USD` zostaje jako bezpiecznik globalny.

### 4.6 Ścieżka konwersji

- **Zwiad → Solo:** ranking pokazuje 3 pozycje i zablokowany wiersz *„jeszcze 4 okazje dziś,
  najlepsza 87%"*. Alert 90%+ przychodzi jako push bez treści: *„Agent znalazł okazję 91%.
  Odblokuj, by zobaczyć"*. Motorem jest **strach przed przegapieniem**, nie limit funkcji.
- **Solo → Ekspert:** na ekranie szczegółów przetargu, pod uzasadnieniem, karta:
  *„To ogłoszenie ma 34 strony. Ekspert streści je w 5 punktach, wypisze wymagane dokumenty
  i sprawdzi, czy się kwalifikujesz."* + *„Podobne zamówienie wygrała firma X za 340 tys."*
  (kwota rozmyta). Motorem jest **oszczędność czasu w momencie realnej potrzeby**.

---

## 5. Nowy silnik scoringu

### 5.1 Architektura oceny (trzy etapy, koszt pod kontrolą)

```text
500 ogłoszeń/dzień
   │
   ├─ ETAP 1: FILTRY TWARDE (SQL, koszt ~0)                    → ~80 kandydatów
   │
   ├─ ETAP 2: SCORING WAŻONY (czysta funkcja, koszt ~0)        → top N wg planu
   │
   ├─ ETAP 3: AI RE-RANK (Claude Haiku, top N)                 → ranking dnia
   │            N = 3 (Zwiad) / 30 (Solo) / 60 (Ekspert)
   │
   └─ ETAP 4: ANALIZA OGŁOSZENIA (tylko Ekspert, LENIWIE)      → na żądanie
                htmlBody 27 KB → streszczenie + dokumenty + warunki
                cache współdzielony w `tender_analysis`
```

To odwraca dzisiejszą logikę: dziś AI jest bramkowane heurystyką *per przetarg*, więc błędy P-1
i P-2 cicho je wyłączają. Nowa wersja generuje kandydatów, sortuje ich tanio, i puszcza do AI
**stałą, ograniczoną liczbę**. Koszt przestaje zależeć od liczby ogłoszeń — zależy tylko od planu.

Szacunek (Haiku 4.5, wg `lib/pricing.js`: $1/M wej., $5/M wyj.; ~1500 wej. + 150 wyj. na wywołanie):
`≈ $0,00225 × N` dziennie. Pełna kalkulacja marż w sekcji 4.5.

**Etap 4 nigdy nie działa hurtem.** Nie analizujemy 500 ogłoszeń — analizujemy to jedno, które
użytkownik otworzył, a wynik trafia do współdzielonego cache. To jedyny powód, dla którego
plan Ekspert za 99 zł się spina.

### 5.2 Etap 1 — filtry twarde (knockout)

Odrzucamy zanim cokolwiek policzymy:

| Warunek | Uzasadnienie |
|---|---|
| `deadline < now + 24h` | Nie zdąży złożyć oferty |
| `province ∉ user.provinces` (gdy ustawione) | Jawna decyzja użytkownika |
| `distance(user.base, tender.city) > user.radius_km` (gdy geokod dostępny) | Promień działania |
| `user_tender_state = 'hidden'` | Użytkownik ukrył |
| `matches.exists(user, tender)` | Już oceniony |

### 5.3 Etap 2 — scoring ważony

`S_base = Σ (wᵢ × sᵢ)`, gdzie `sᵢ ∈ [0,1]`, `Σ wᵢ = 100`.

| # | Komponent | Waga `wᵢ` | Zakres personalizacji |
|---|---|---:|---|
| 1 | CPV | **22** | 13,2 – 30,8 |
| 2 | Słowa kluczowe / usługi | **18** | 10,8 – 25,2 |
| 3 | Lokalizacja | **15** | 9,0 – 21,0 |
| 4 | Personalizacja (historia zachowań) | **12** | 7,2 – 16,8 |
| 5 | Wartość (szacowana) | **12** | 7,2 – 16,8 |
| 6 | Branża | **8** | 4,8 – 11,2 |
| 7 | Termin | **8** | 4,8 – 11,2 |
| 8 | Typ zamawiającego | **5** | 3,0 – 7,0 |
| | **Suma** | **100** | każda waga w ±40% od domyślnej, po korekcie renormalizacja do 100 |

**Funkcje cząstkowe:**

**1. CPV (w=22).** `max` po iloczynie kartezjańskim (kody użytkownika × **wszystkie** kody przetargu):
| Zgodność | `s` |
|---|---|
| pełne 8 cyfr | 1,00 |
| grupa (5 cyfr) | 0,80 |
| klasa (4 cyfry) | 0,60 |
| dział (2 cyfry) | 0,35 |
| brak | 0,00 |

**2. Słowa kluczowe (w=18).** Normalizacja: lowercase → usunięcie diakrytyków → obcięcie
końcówek fleksyjnych (rdzeń ≥ 5 znaków). Dopasowanie rdzeni w `orderObject`.
`s = min(1, trafione / max(1, min(liczba_rdzeni_profilu, 4)))` — nie karzemy za długą listę usług.
Bonus `+0,15` (cap 1,0), gdy trafienie w pierwszych 60 znakach tytułu.

**3. Lokalizacja (w=15).** `d` = odległość haversine od bazy użytkownika, `R` = `radius_km`.
| Warunek | `s` |
|---|---|
| `d ≤ 0,33·R` | 1,00 |
| `d ≤ 0,66·R` | 0,75 |
| `d ≤ R` | 0,50 |
| to samo województwo, `d > R` | 0,20 |
| brak geokodu, województwo na liście | 0,70 |
| pozostałe | 0,00 |

**4. Personalizacja (w=12).** `s = σ(Σ_f a_f^eff)` przeskalowana do [0,1], domyślnie **0,5**.
Cechy `f`: `cpv_division`, `province`, `client_type`, `order_type`, `organization_id`.
Shrinkage: `a_f^eff = a_f × n_f / (n_f + 5)` — cecha z 1 obserwacją prawie nie wpływa.
Do 20 zdarzeń użytkownika komponent jest zamrożony na 0,5 (cold start).

**5. Wartość (w=12).** Na `value_estimate` + `value_confidence` (sekcja 3.2).
| Warunek | `s` przed korektą |
|---|---|
| estymata w `[min_value, max_value]` | 1,00 |
| estymata ±30% poza granicą | 0,60 |
| estymata daleko poza | 0,10 |
| brak estymaty | 0,50 (neutralnie) |

Korekta pewnością: `s = 0,5 + (s − 0,5) × value_confidence`.
Czyli przy `conf = 0,2` nawet skrajne niedopasowanie ledwo rusza wynik. **Nie zgadujemy z pewnością siebie.**

**6. Branża (w=8).**
`orderType ∈ user.industries.order_types` → 1,00; dział CPV ∈ działy branż użytkownika → 0,70; inaczej 0.

**7. Termin (w=8).** `d` = dni do `submittingOffersDate`.
| `d` | `s` |
|---|---|
| < 3 | 0,20 |
| 3–7 | 0,70 |
| 8–21 | 1,00 |
| > 21 | 0,85 |

**8. Typ zamawiającego (w=5).** Z `user_feature_affinity('client_type')`, domyślnie 0,5.
Bonus startowy 0,8 dla gmin/urzędów miejskich (mniejsze kontrakty — dopasowane do persony).

**Bonusy addytywne (po sumie, cap 100):**
- `parts_count ≥ 2` → **+4** (przetarg podzielony na części = dostępny dla JDG)
- ogłoszenie od zamawiającego, u którego user już zapisał przetarg → **+3**

### 5.4 Etap 3 — AI re-rank

Tylko top N wg `S_base` (N zależny od planu: 3 / 30 / 60), tylko gdy `features.ai` i budżet nie przekroczony.
Model dostaje profil + ogłoszenie + `score_breakdown` i zwraca `{score: 0-100, reasoning}`.

`S_final = clamp(0, 100, S_base + (S_ai − 50) × 0,3)`

AI może przesunąć wynik o **±15 punktów** — koryguje, nie dyktuje. Uzasadnienie od AI trafia do UI.
Gdy AI padnie / budżet wyczerpany → `S_final = S_base`, uzasadnienie generowane z `score_breakdown`
(szablon zdaniowy). **Produkt działa bez AI**, tak jak dziś.

Do rankingu dnia trafiają pozycje z `S_final ≥ user.min_score` (domyślnie 60).

### 5.5 Mechanizm automatycznej korekty wag

**Zdarzenia i nagrody** (`r ∈ [−1, 1]`):

| Zdarzenie | `r` |
|---|---|
| `marked_interesting` | **+1,0** |
| `opened_bzp` (kliknął w oryginał) | +0,7 |
| `saved` | +0,6 |
| `opened` (wszedł w szczegóły) | +0,2 |
| `impression_ignored` (3× pokazany, 0 otwarć) | −0,05 |
| `hidden` | −0,6 |
| `marked_not_relevant` | **−1,0** |

**A) Afinicje cech** (szybkie, `η_a = 0,15`):

```
a_f ← clamp(−1, 1,  a_f + η_a · r · (1 − |a_f|))
n_f ← n_f + 1
```
Człon `(1 − |a_f|)` hamuje przy krańcach — afinicja nigdy nie „przestrzeli".
Miesięczny zanik: `a_f ← 0,95 · a_f` (świeżość ważniejsza niż historia sprzed roku).

**B) Wagi komponentów** (wolne, `η_w = 0,6` punktu, dopiero od 20 zdarzeń):

```
s̄  = średnia sᵢ dla tego przetargu
wᵢ ← wᵢ + η_w · r · (sᵢ − s̄)
wᵢ ← clamp(0,6·wᵢ⁰, 1,4·wᵢ⁰)     // maks. ±40% od domyślnej
w  ← w · 100 / Σw                 // renormalizacja
```

Intuicja: jeśli user oznaczył przetarg jako trafny, a ten przetarg wyróżniał się **lokalizacją**
(`s_lokalizacja` mocno powyżej średniej), to waga lokalizacji rośnie. Jeśli oznaczył jako
nietrafny, a wyróżniał się CPV — waga CPV maleje.

**Zabezpieczenia (bez nich to się rozjedzie):**
- **Bańka informacyjna:** przetarg z `S_base ≥ 90` **nigdy** nie zostaje odfiltrowany przez personalizację.
- **Eksploracja (P2):** z prawdopodobieństwem ε = 0,10 do rankingu wchodzi 1 pozycja z pasma
  50–70, oznaczona „Warte uwagi". Bez tego agent zabetonuje się we własnych założeniach.
- **Audytowalność:** każda zmiana wektora wag idzie do `user_weight_history` → rollback i debug.
- **Cold start:** wagi zamrożone do 20 zdarzeń, afinicje działają od `n_f ≥ 3` (przez shrinkage).

---

## 6. Zmiany w bazie danych

### 6.0 WARUNEK WSTĘPNY: runner migracji

Dziś go nie ma (sekcja 2.2). Bez tego żadna z poniższych zmian nie jest wykonalna na
istniejącej bazie produkcyjnej.

**Nowa tabela `schema_migrations`**
| Kolumna | Typ |
|---|---|
| `id` | TEXT PRIMARY KEY (np. `001_add_profile_fields`) |
| `applied_at` | TEXT NOT NULL |
| `checksum` | TEXT |

Runner: pliki `db/migrations/NNN_nazwa.sql` (lub `.js` dla rebuildów), sortowane po numerze,
każda w transakcji, zapis do `schema_migrations` po sukcesie. `schema.sql` zostaje jako
**bootstrap dla świeżej bazy**; migracje dokładają zmiany na istniejącej.
**Wpływ na API:** brak.

---

### 6.1 `users` — profil bez NIP

**Migracja `001` — rebuild tabeli** (SQLite nie usunie `NOT NULL` przez `ALTER`; potrzebna
12-krokowa procedura: `PRAGMA foreign_keys=OFF` → `CREATE users_new` → `INSERT SELECT` →
`DROP users` → `RENAME` → odtworzenie indeksów → `PRAGMA foreign_keys=ON`, całość w transakcji).

Zmiany (wszystkie trzy w **jednej** przebudowie — SQLite nie zmieni ani `NOT NULL`, ani `CHECK` przez `ALTER`):
- `company_nip TEXT NOT NULL UNIQUE` → **`company_nip TEXT UNIQUE`** (nullable; SQLite dopuszcza wiele NULL)
- `company_name TEXT NOT NULL` → **`display_name TEXT NOT NULL`** (zachowujemy kolumnę `company_name` jako alias w migracji `INSERT SELECT`)
- `premium_tier CHECK (premium_tier IN ('free','standard'))` →
  **`CHECK (premium_tier IN ('free','solo','ekspert'))`**
  Mapowanie danych w `INSERT SELECT`: `'standard' → 'ekspert'` (bezpiecznik; w TEST mode nie ma
  żywych subskrybentów, ale migracja musi być poprawna także na kopii prod).

**Migracja `002` — nowe kolumny** (czyste `ALTER TABLE ADD COLUMN`, bezpieczne):

| Kolumna | Typ | Domyślnie | Cel |
|---|---|---|---|
| `industries` | TEXT | `'[]'` | JSON: `["works.roads","works.paving"]` |
| `services` | TEXT | `'[]'` | JSON: opisy usług (źródło rdzeni) |
| `base_city` | TEXT | NULL | miasto bazowe |
| `base_lat` | REAL | NULL | geokod |
| `base_lon` | REAL | NULL | geokod |
| `radius_km` | INTEGER | `50` | promień działania |
| `provinces` | TEXT | `'[]'` | JSON: `["PL26","PL12"]` |
| `min_value` | INTEGER | NULL | dolna granica (PLN) |
| `max_value` | INTEGER | NULL | górna granica (PLN) |
| `min_score` | INTEGER | `60` | próg dopasowania |
| `weight_profile` | TEXT | NULL | JSON wektora wag (NULL = domyślne) |
| `digest_hour` | INTEGER | `8` | godzina powiadomienia |
| `theme` | TEXT | `'system'` | `system` / `light` / `dark` — wybór użytkownika |
| `onboarding_completed_at` | TEXT | NULL | aktywacja |
| `events_count` | INTEGER | `0` | licznik do cold startu |
| `plan_price_id` | TEXT | NULL | `price_...` ze Stripe — źródło prawdy o planie |
| `subscription_status` | TEXT | `'none'` | `none`/`active`/`past_due`/`canceled` |
| `current_period_end` | TEXT | NULL | do wygaszania dostępu |
| `analysis_quota_used` | INTEGER | `0` | licznik analiz AI w bieżącym miesiącu (Ekspert) |
| `analysis_quota_reset_at` | TEXT | NULL | początek okresu rozliczeniowego kwoty |

`keywords` i `cpv_codes` **zostają bez zmian nazw** — zero breaking change w `repos.mapUser`.

**Wpływ na API:**
- `POST /auth/register` — `company_nip` i `company_name` stają się **opcjonalne**;
  przyjmujemy też `display_name`. Walidacja NIP odpala się **tylko gdy pole podane**.
  Stare klienty mobilne działają dalej (pola nadal akceptowane).
- `PATCH /auth/me` — rozszerzony `profileSchema` o nowe pola.
- `publicUser()` — dokłada nowe pola; `company_nip` może być `null`.

**⚠️ Pułapka fakturowania.** `services/invoice.js` (Fakturownia) wystawia fakturę VAT — **potrzebuje NIP**.
Skoro NIP znika z rejestracji, musi być **zbierany przy checkoucie**:
Stripe Checkout `tax_id_collection: { enabled: true }` (lub custom field) → webhook zapisuje
`company_nip` + `company_name` na userze → dopiero wtedy Fakturownia. Bez tego kroku
migracja **zepsuje wystawianie faktur**. To jest zadanie blokujące w etapie E3.

---

### 6.2 `tenders` — wzbogacenie z BZP

**Migracja `003` — `ALTER TABLE ADD COLUMN`:**

| Kolumna | Typ | Źródło |
|---|---|---|
| `order_type` | TEXT | `orderType` (`Works`/`Services`/`Delivery`) |
| `province` | TEXT | `organizationProvince` (`PL14`) |
| `city` | TEXT | `organizationCity` |
| `lat` / `lon` | REAL | geokodowanie `city` (tablica offline) |
| `client_type` | TEXT | `clientType` |
| `organization_id` | TEXT | `organizationId` |
| `parts_count` | INTEGER | parsowanie `htmlBody` (`Część N`) |
| `realization_days` | INTEGER | `htmlBody` → `4.2.10.) Okres realizacji…` |
| `realization_from` / `realization_to` | TEXT | jw. (gdy podane datami) |
| `value_estimate` | INTEGER | z `tender_value_stats` |
| `value_confidence` | REAL | jw. |

`budget` **zostaje** (zawsze `null`) — usunięcie złamałoby `publicMatch` i mobile. Deprecated.

**Uwaga o `htmlBody`:** 27 KB × 500/dzień ≈ **13,5 MB/dzień**. `normalizeNotice` dziś go **wyrzuca** —
i słusznie. Parsujemy przy ingestii, zapisujemy **wyekstrahowane pola**, `htmlBody` nie ląduje w bazie.

**Wpływ na API:** `publicMatch().tender` dostaje nowe pola. Addytywnie — stare klienty ignorują.

---

### 6.3 `tender_cpv` — NOWA (naprawa P-1)

Rozbicie sklejonego `cpvCode` na wiersze. To jest strukturalna naprawa błędu #1.

| Kolumna | Typ |
|---|---|
| `tender_id` | TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE |
| `cpv_code` | TEXT NOT NULL (8 cyfr, bez cyfry kontrolnej) |
| `cpv_division` | TEXT NOT NULL (2 cyfry) |
| `is_main` | INTEGER NOT NULL DEFAULT 0 |

`PRIMARY KEY (tender_id, cpv_code)`, `INDEX (cpv_division)`, `INDEX (cpv_code)`.

Backfill: jednorazowy skrypt po wszystkich istniejących `tenders`.
**Wpływ na API:** `tender.cpv` przestaje być 300-znakowym łańcuchem; zwracamy tablicę
`[{code, label, is_main}]`. **To jest jedyny breaking change w API** — wymaga wersji mobile
lub zachowania `cpv` jako string obok nowego `cpv_list` (rekomendacja: zachować oba przez 1 wersję).

---

### 6.4 `user_events` — NOWA (telemetria zachowań)

| Kolumna | Typ |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `tender_id` | TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE |
| `match_id` | TEXT REFERENCES matches(id) ON DELETE SET NULL |
| `event_type` | TEXT NOT NULL CHECK IN (`impression`,`opened`,`saved`,`hidden`,`marked_interesting`,`marked_not_relevant`,`opened_bzp`) |
| `reward` | REAL NOT NULL |
| `created_at` | TEXT NOT NULL |

`INDEX (user_id, created_at)`, `INDEX (user_id, tender_id)`.

**Migracja `004` — backfill z `feedback`:** `helpful=1` → `marked_interesting` (r=+1),
`helpful=0` → `marked_not_relevant` (r=−1). Tabela `feedback` **zostaje** (nie usuwamy,
stare API działa), ale nowy kod pisze do `user_events`.

**Wpływ na API:** nowy `POST /events`. `POST /matches/:id/feedback` zostaje jako alias (deprecated).

---

### 6.5 `user_tender_state` — NOWA (zapisane / ukryte)

| Kolumna | Typ |
|---|---|
| `user_id` | TEXT NOT NULL |
| `tender_id` | TEXT NOT NULL |
| `state` | TEXT NOT NULL CHECK IN (`saved`,`hidden`) |
| `created_at` | TEXT NOT NULL |

`PRIMARY KEY (user_id, tender_id)`. Stan bieżący, w odróżnieniu od `user_events` (log zdarzeń).
**Wpływ na API:** `PUT /tenders/:id/state`, `DELETE /tenders/:id/state`, `GET /me/saved`.

---

### 6.6 `user_feature_affinity` — NOWA (pamięć agenta)

| Kolumna | Typ |
|---|---|
| `user_id` | TEXT NOT NULL |
| `feature_type` | TEXT NOT NULL (`cpv_division`,`province`,`client_type`,`order_type`,`organization_id`) |
| `feature_key` | TEXT NOT NULL |
| `affinity` | REAL NOT NULL DEFAULT 0 (zakres −1..1) |
| `evidence_count` | INTEGER NOT NULL DEFAULT 0 |
| `updated_at` | TEXT NOT NULL |

`PRIMARY KEY (user_id, feature_type, feature_key)`.
**Wpływ na API:** brak (wewnętrzne). Ekspozycja opcjonalna w `GET /me/insights`.

---

### 6.7 `user_weight_history` — NOWA (audyt korekty wag)

| Kolumna | Typ |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL |
| `weights` | TEXT NOT NULL (JSON) |
| `trigger_event_id` | TEXT |
| `created_at` | TEXT NOT NULL |

**Wpływ na API:** brak.

---

### 6.8 `tender_value_stats` — NOWA (estymator wartości)

| Kolumna | Typ |
|---|---|
| `cpv_division` | TEXT NOT NULL |
| `order_type` | TEXT NOT NULL |
| `province` | TEXT (NULL = agregat krajowy) |
| `n` | INTEGER NOT NULL |
| `median_value` | INTEGER NOT NULL |
| `p25` / `p75` | INTEGER |
| `updated_at` | TEXT NOT NULL |

`PRIMARY KEY (cpv_division, order_type, province)`. Zasilane przez `jobs/fetchResults.js`.
**Wpływ na API:** `tender.value_estimate` + `value_confidence` w `publicMatch`.

---

### 6.9 `daily_digest` — NOWA („Dzisiejsze okazje")

| Kolumna | Typ |
|---|---|
| `user_id` | TEXT NOT NULL |
| `digest_date` | TEXT NOT NULL (`YYYY-MM-DD`) |
| `match_ids` | TEXT NOT NULL (JSON, kolejność = ranking) |
| `top_score` | INTEGER |
| `generated_at` | TEXT NOT NULL |
| `notified_at` | TEXT |

`PRIMARY KEY (user_id, digest_date)`.
**Wpływ na API:** nowy `GET /today`.

---

### 6.10 `matches` — rozszerzenie

**Migracja `005` — `ALTER TABLE ADD COLUMN`:**

| Kolumna | Typ | Cel |
|---|---|---|
| `base_score` | INTEGER | wynik przed AI |
| `score_breakdown` | TEXT | JSON: `{cpv:0.8, location:1.0, …}` — explainability |
| `ai_adjusted` | INTEGER DEFAULT 0 | czy AI ruszyło wynik |
| `rank_in_day` | INTEGER | pozycja w rankingu dnia |

`confidence_score` zostaje jako `S_final`. **Wpływ na API:** `publicMatch` dokłada pola. Addytywnie.

---

### 6.11 `tender_analysis` — NOWA (plan Ekspert, cache współdzielony)

Streszczenie ogłoszenia jest **niezależne od użytkownika** → jedna analiza obsługuje wszystkich.
To jest mechanizm, który sprawia, że Ekspert za 99 zł ma 79% marży.

| Kolumna | Typ |
|---|---|
| `tender_id` | TEXT PRIMARY KEY REFERENCES tenders(id) ON DELETE CASCADE |
| `summary` | TEXT NOT NULL (JSON: 5 punktów) |
| `required_docs` | TEXT (JSON: lista dokumentów) |
| `participation_conditions` | TEXT (JSON: warunki udziału) |
| `realization_summary` | TEXT |
| `model` | TEXT NOT NULL |
| `input_tokens` / `output_tokens` | INTEGER |
| `generated_at` | TEXT NOT NULL |

Generowane **leniwie**, przy pierwszym otwarciu szczegółów przez konto Ekspert.
Wpis do `ai_usage` jak każde wywołanie AI.
**Wpływ na API:** `GET /matches/:id` dla planu Ekspert dokłada `analysis`. Dla Solo/Free — pole
`analysis_available: false` + `upgrade_hint` (materiał na paywall z sekcji 4.6).

---

### 6.12 `user_tender_qualification` — NOWA (plan Ekspert, per-user)

„Czy się kwalifikuję?" — jedyna część analizy zależna od profilu. Tania, bo model dostaje
gotowe `participation_conditions`, a nie 27 KB HTML.

| Kolumna | Typ |
|---|---|
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `tender_id` | TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE |
| `verdict` | TEXT NOT NULL CHECK IN (`qualified`,`partial`,`not_qualified`) |
| `gaps` | TEXT (JSON: czego brakuje) |
| `generated_at` | TEXT NOT NULL |

`PRIMARY KEY (user_id, tender_id)`.
**Wpływ na API:** `POST /matches/:id/qualify` (Ekspert). 402 dla niższych planów.

---

### 6.13 `tender_awards` — NOWA (kto wygrał, za ile)

Zasilane przez `jobs/fetchResults.js` z `TenderResultNotice`. Karmi **jednocześnie**
`tender_value_stats` (estymator) i funkcję „historia podobnych zamówień" (Ekspert).

| Kolumna | Typ |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `bzp_number` | TEXT UNIQUE |
| `cpv_division` | TEXT NOT NULL |
| `order_type` | TEXT |
| `province` | TEXT |
| `organization_id` | TEXT |
| `winner_name` | TEXT (z pola `contractors`) |
| `contract_value` | INTEGER (z `8.2.) Wartość umowy` w `htmlBody`) |
| `offers_count` | INTEGER (gdy dostępne) |
| `published_at` | TEXT NOT NULL |

`INDEX (cpv_division, order_type, province)`.
**Wpływ na API:** `GET /tenders/:id/similar-awards` (Ekspert).

---

### 6.14 Naprawa P-4 (utrata przetargów przez konta Free)

Bez zmiany schematu. `runTenderFetch` przestaje przekazywać tylko `newTenderRecords`.
Nowa pula kandydatów: **wszystkie przetargi z otwartym `deadline`, bez wiersza w `matches`
dla tego usera** (`LEFT JOIN matches ... WHERE m.id IS NULL AND t.deadline > now`).
Dzienny limit Free przestaje wtedy **kasować** przetargi — tylko odracza je na jutro.

**Potwierdzone na żywo (2026-07-09, emulator + 500 realnych ogłoszeń):** konto Free z profilem
brukarza miało **11 przetargów powyżej progu 60%**, zobaczyło **5**. Pozostałe **6 nie pojawi się
nigdy** — w następnym cyklu nie są już „nowe".

**Druga twarz tego samego błędu (nowe ustalenie):** `PATCH /auth/me` **nie uruchamia ponownej
oceny**. Użytkownik dopisuje słowo kluczowe „kostka brukowa" i… nic się nie dzieje. Nowe kryterium
zadziała wyłącznie na ogłoszenia opublikowane po zmianie. Z perspektywy użytkownika profil jest
zepsuty. Rejestracja robi backfill (`tenders.recent(200)` w `routes/auth.js:69`), aktualizacja profilu — nie.

**Poprawka:** wynieść backfill do `services/matching.js` i wołać go z **obu** miejsc
(rejestracja i każda istotna zmiana profilu: `keywords`, `cpv_codes`, `industries`, `provinces`,
`radius_km`, `min_value`, `max_value`). Fire-and-forget z logiem, jak dziś przy rejestracji.

---

## 7. Nowy onboarding (krok po kroku)

Cel: **czas do pierwszej wartości < 90 sekund**, zero pól, których persona nie rozumie.

| Krok | Ekran | Zbieramy | Uwagi |
|---|---|---|---|
| **1** | Konto | e-mail + hasło | **Bez NIP. Bez nazwy firmy.** |
| **2** | „Czym się zajmujesz?" | `industries` | 8–10 dużych kafli z ikonami: *Roboty drogowe*, *Budownictwo ogólne*, *Instalacje elektryczne*, *Hydraulika*, *Zieleń i utrzymanie*, *Sprzątanie*, *Transport*, *IT i cyfryzacja*, *Usługi projektowe*. Multi-select. Mapują się na `orderType` + działy CPV. |
| **3** | „Co konkretnie robisz?" | `services` → `keywords` + `cpv_codes` | Chipsy podpowiadane z kroku 2 (*kostka brukowa*, *nawierzchnie asfaltowe*, *odwodnienia*) + pole własne. **Kody CPV wyprowadzamy w tle — user ich nie widzi.** |
| **4** | „Gdzie pracujesz?" | `base_city`, `base_lat/lon`, `radius_km` | Autocomplete miasta + suwak 25 / 50 / 100 / 200 km. Mapa poglądowa. Link „wolę wybrać województwa" → `provinces`. |
| **5** | „Jakiej skali zlecenia bierzesz?" | `min_value`, `max_value` | Presety: *do 50 tys.* / *50–200 tys.* / *200 tys.–1 mln* / *powyżej 1 mln* / *nie wiem*. **Copy musi mówić wprost: „to szacunek — BZP nie podaje wartości w ogłoszeniu"** (sekcja 3.2). „Nie wiem" → komponent neutralny. |
| **6** | „Kiedy Cię powiadamiać?" | `digest_hour`, `min_score` | Godzina (domyślnie 8:00) + suwak „pokazuj tylko dopasowania powyżej **60%**". Zgoda na push. |
| **7** | **Aktywacja** | — | Natychmiastowy backfill z ostatnich 7 dni → *„Znaleźliśmy dla Ciebie **7 okazji**. Najlepsza: 91%."* → wejście prosto na dashboard. |

Krok 7 jest **najważniejszy**. Dziś po rejestracji feed jest pusty do następnego crona (do 6 h).
Backfill istnieje w `routes/auth.js` (`tenders.recent(200)`), ale jest fire-and-forget i user
go nie widzi. Nowy onboarding **czeka** na wynik (z timeoutem i skeletonem) i pokazuje liczbę.

`onboarding_completed_at` ustawiane po kroku 7. Kroki 2–6 są przerywalne — profil zapisujemy
inkrementalnie po każdym kroku (`PATCH /auth/me`).

---

## 8. Nowy dashboard mobilny

### 8.1 Zmiana nawigacji

`RootNavigator`: `MatchFeed` (lista chronologiczna) przestaje być ekranem głównym.

```
Tab 1: Dziś        ← nowy ekran główny „Dzisiejsze okazje"
Tab 2: Zapisane
Tab 3: Szukaj      ← stary feed, przemianowany (dostęp do pełnej bazy)
Tab 4: Profil      ← stary AccountScreen + edycja profilu agenta
```

### 8.2 Ekran „Dzisiejsze okazje" — sekcje w kolejności

| # | Sekcja | Zawartość | Uzasadnienie |
|---|---|---|---|
| **1** | Nagłówek agenta | *„Dzień dobry. Sprawdziłem dziś **487 ogłoszeń** i wybrałem **6**."* + data | Buduje poczucie, że agent pracował. To jest cały produkt w jednym zdaniu. |
| **2** | Pasek KPI | 4 kafle (niżej) | Kontekst w 2 sekundy |
| **3** | **Top 3 okazje** | Duże karty: score, tytuł, zamawiający, odległość, szacowana wartość, **jednozdaniowe uzasadnienie**, akcje swipe | Sedno. Persona ma zdecydować bez scrollowania. |
| **4** | Kończy się wkrótce | `deadline ≤ 3 dni` spośród zapisanych i dzisiejszych | Ratuje przed przegapieniem |
| **5** | Blisko Ciebie | `d ≤ 0,33·R`, score ≥ 50 | Najtańsze zlecenia logistycznie |
| **6** | Warte uwagi | 1 pozycja z eksploracji (pasmo 50–70), oznaczona jako eksperyment | Chroni przed bańką |
| **7** | Reszta dzisiejszych | zwinięte, „pokaż pozostałe 3" | Nie zaśmieca |
| **8** | Stan pusty | *„Dziś nic wartego Twojego czasu. Sprawdziłem 487 ogłoszeń."* + CTA *„Poszerz profil"* / *„Obniż próg do 50%"* | **Brak okazji to też wynik pracy agenta** — nie może wyglądać jak awaria |

**Akcje na karcie:** swipe w prawo → `saved`; swipe w lewo → `hidden`;
long-press → `marked_interesting` / `marked_not_relevant`; tap → szczegóły (`opened`).
Każda akcja emituje `POST /events`.

### 8.3 KPI (pasek, sekcja 2)

| KPI | Wartość | Po co |
|---|---|---|
| **Nowe dziś** | liczba pozycji w digeście | Główna metryka wartości |
| **Kończy się** | ile zapisanych ma `deadline ≤ 3 dni` | Pilność, driver otwarć |
| **Zapisane** | licznik aktywnych | Poczucie kontroli |
| **Trafność agenta** | `marked_interesting / (interesting + not_relevant)` za 30 dni | **Zaufanie.** Pokazujemy dopiero od 10 ocen. Spadek < 50% → prompt „popraw profil" |

Świadomie **nie** pokazujemy „średniego score" — to metryka nasza, nie użytkownika.

### 8.4 Powiadomienia

| Typ | Trigger | Treść | Plan |
|---|---|---|---|
| **Digest dzienny** | `digest_hour` (domyślnie 8:00) | *„6 nowych okazji. Najlepsza: 91% — Przebudowa drogi, Kielce, 12 km"* | Free: 1×/dzień, top 3. Standard: pełny |
| **Alert wysokiego dopasowania** | `S_final ≥ 90` przy poborze | *„🎯 91% — Przebudowa drogi gminnej, 12 km od Ciebie"* | **Tylko Standard** (motor konwersji) |
| **Przypomnienie o terminie** | zapisany przetarg, `deadline − 3 dni` | *„Za 3 dni mija termin: Przebudowa drogi"* | Oba |
| **Tygodniowe podsumowanie** | niedziela 18:00 | *„W tym tygodniu: 34 okazje, 5 zapisanych. Twój agent nauczył się, że wolisz zlecenia < 40 km."* | Oba (retencja) |

**Zasady:** cisza 21:00–7:00. Maks. 1 push/dzień dla Free. Alert 90%+ omija limit tylko dla Standard.
`daily_digest.notified_at` zapobiega duplikatom przy restarcie crona.

---

## 9. Zmiany backendu — mapa plików

| Plik | Zmiana |
|---|---|
| `db/migrate.js` | **przepisany** na runner migracji (`schema_migrations`) |
| `db/migrations/*` | **nowy** katalog |
| `db/repos.js` | + `userEvents`, `userTenderState`, `userFeatureAffinity`, `dailyDigest`, `tenderCpv`, `tenderValueStats`; `tenders.candidatesFor(user)` |
| `lib/scoring.js` | **serce zmiany**: `heuristicScore` → `scoreComponents(user, tender)` zwracające `{components, base, breakdown}` |
| `lib/textNorm.js` | **nowy**: diakrytyki + rdzenie fleksyjne (naprawa P-2) |
| `lib/cpv.js` | **nowy**: parser sklejonego `cpvCode`, poziomy zgodności (naprawa P-1) |
| `lib/geo.js` | **nowy**: haversine + offline tablica miast→lat/lon |
| `lib/provinces.js` | **nowy**: `PL02..PL32` → nazwy województw |
| `services/bzp.js` | `normalizeNotice` + `order_type`, `province`, `city`, `client_type`, `organization_id`; parser `htmlBody` (parts, okres realizacji) |
| `services/matching.js` | 3-etapowy pipeline (filtry → scoring → AI re-rank top 30) |
| `services/ai.js` | prompt dostaje profil + `score_breakdown`; AI koryguje ±15 |
| `services/learning.js` | **nowy**: aktualizacja afinicji i wag |
| `services/valueEstimator.js` | **nowy**: `tender_value_stats` → `value_estimate` |
| `jobs/fetchTenders.js` | naprawa P-4 (pula kandydatów, nie tylko „nowe") |
| `jobs/fetchResults.js` | **nowy**: `TenderResultNotice` → kwoty → `tender_value_stats` |
| `jobs/buildDigest.js` | **nowy**: ranking dnia + push |
| `routes/auth.js` | NIP opcjonalny; rozszerzony `profileSchema` |
| `routes/today.js` | **nowy**: `GET /today` |
| `routes/events.js` | **nowy**: `POST /events` |
| `routes/tenders.js` | **nowy**: `PUT/DELETE /tenders/:id/state`, `GET /me/saved` |
| `routes/upgrade.js` | parametr `plan` (`solo`\|`ekspert`); Stripe `tax_id_collection` → NIP (blokujące dla Fakturowni) |
| `lib/plans.js` | **nowy**: jedno źródło prawdy o uprawnieniach (patrz niżej) |
| `services/analysis.js` | **nowy**: `htmlBody` → streszczenie + dokumenty + warunki; cache `tender_analysis` |
| `services/qualification.js` | **nowy**: warunki udziału × profil → werdykt |
| `services/stripe.js` | `createCheckoutSession({user, plan})` — koniec zaszytego `STRIPE_PRICE_STANDARD` |
| `routes/webhooks.js` | mapowanie `price_id → premium_tier`; **obsługa `customer.subscription.updated` dla PrzetargAI** (dziś jej NIE MA); zapis NIP z `customer_details.tax_ids` |
| `routes/analysis.js` | **nowy**: `POST /matches/:id/qualify`, `GET /tenders/:id/similar-awards` |
| `lib/serialize.js` | `publicUser` + nowe pola; `publicMatch` + `score_breakdown`, `cpv_list`, geo, wartość, `analysis_available` |

**`lib/plans.js` — likwidacja rozsianych warunków.** Dziś `premium_tier === 'standard'` sprawdza się
w trzech miejscach (`jobs/fetchTenders.js:52`, `routes/auth.js:137`, `routes/upgrade.js:27`).
Przy trzech planach to się rozjedzie. Jedna deklaratywna tabela zdolności:

```text
free    → { dailyPicks: 3,  aiRerank: 3,  alerts: false, saveLimit: 5, learning: false,
            analysis: false, profiles: 1 }
solo    → { dailyPicks: 10, aiRerank: 30, alerts: true,  saveLimit: ∞, learning: true,
            analysis: false, profiles: 1 }
ekspert → { dailyPicks: 10, aiRerank: 60, alerts: true,  saveLimit: ∞, learning: true,
            analysis: true,  analysisQuota: 50, awards: true, export: true, profiles: 3 }
```

Odmowa dostępu do funkcji planu wyższego zwraca **`402 Payment Required`** z `upgrade_hint`,
nie `403` — apka renderuje z tego paywall.
`FREE_TIER_DAILY_MATCH_LIMIT` z `.env` znika, zastąpione przez `plans.free.dailyPicks`.

**Czego NIE ruszamy:** `middleware/*`, `lib/errors.js`, `lib/audit.js`, `services/push.js`,
cała gałąź `fitter*` (w tym jej ścieżki w `webhooks.js` i `stripe.js`).

---

## 10. Zmiany mobile — mapa plików

| Plik | Zmiana |
|---|---|
| `src/navigation/RootNavigator.js` | stack → **bottom tabs** (Dziś / Zapisane / Szukaj / Profil) |
| `src/screens/TodayScreen.js` | **nowy** — dashboard z sekcji 8 |
| `src/screens/OnboardingScreen.js` | **nowy** — 7-krokowy wizard |
| `src/screens/SavedScreen.js` | **nowy** |
| `src/screens/MatchFeedScreen.js` | przemianowany na „Szukaj", zostaje |
| `src/screens/RegisterScreen.js` | **usuwamy pola NIP i nazwa firmy** |
| `src/screens/AccountScreen.js` | edycja profilu agenta (branże, usługi, promień, wartość, próg) |
| `src/screens/MatchDetailScreen.js` | `score_breakdown` jako „dlaczego to dopasowanie" + akcje uczące + `cpv_list` zamiast 300-znakowego stringa |
| `src/components/OpportunityCard.js` | **nowy** — karta ze swipe (`react-native-gesture-handler`) |
| `src/components/ScoreRing.js` | **nowy** — wizualizacja score |
| `src/api/client.js` | + `getToday`, `sendEvent`, `setTenderState`, `getSaved`, `getInsights`, `qualify`, `getSimilarAwards` |
| `src/services/push.js` | obsługa kategorii powiadomień |
| `src/screens/PlansScreen.js` | **nowy** — porównanie Zwiad / Solo / Ekspert, wybór planu → checkout |
| `src/components/Paywall.js` | **nowy** — reaguje na `402` + `upgrade_hint` z API |
| `src/components/AnalysisCard.js` | **nowy** — streszczenie AI, dokumenty, „czy się kwalifikuję", historia wygranych |
| `src/theme.js` | **przebudowa**: tokeny zamiast stałych; dwa motywy (jasny i ciemny) |
| `src/context/ThemeContext.js` | **nowy** — wybór `system` / `jasny` / `ciemny`, trwały w magazynie |

**Tryb ciemny i jasny do wyboru.** Dziś `theme.js` eksportuje stałe kolory, a `app.json` ma
`"userInterfaceStyle": "light"` — tryb ciemny jest wyłączony na poziomie natywnym. Zmiana:
tokeny semantyczne (`ink`, `ground`, `surface`, `muted`, `accent`, `positive`) w dwóch zestawach,
`userInterfaceStyle: "automatic"`, oraz przełącznik na ekranie Profil z trzema stanami —
**Jak w systemie / Jasny / Ciemny**. Wybór zapisujemy lokalnie (natychmiastowy start bez migotania)
**i** na koncie (`users.theme`), żeby przenosił się między urządzeniami.
Persona pracuje na budowie w pełnym słońcu i w kabinie koparki po zmroku — to nie jest kaprys estetyczny.
Prototyp ma już obie palety; brakuje wyłącznie przełącznika i trwałości wyboru.

**Paywall jest sterowany serwerem.** Apka nie zna cennika ani zasad — dostaje `402` z `upgrade_hint`
i renderuje. Dzięki temu zmiana limitów nie wymaga nowego buildu w sklepach.
`AccountScreen` musi też pokazywać zużycie kwoty analiz (`analysis_quota_used / 50`).

Nowe zależności: `@react-navigation/bottom-tabs`, `react-native-gesture-handler`,
`react-native-reanimated` (swipe). Wszystkie kompatybilne z Expo SDK 54.

---

## 11. Etapy implementacyjne

Każdy etap jest **samodzielnie wdrażalny** i nie psuje działającej aplikacji.

| Etap | Nazwa | Zawartość | Weryfikacja |
|---|---|---|---|
| **E0** | Fundament | Runner migracji + `schema_migrations`. Testy tras (auth, matches, IDOR, webhook) | `npm test` zielony, migracja idempotentna na kopii prod |
| **E1** | Naprawa scoringu | `lib/cpv.js`, `lib/textNorm.js`, `scoring.js` używa listy CPV i rdzeni | **Pomiar przed/po na tych samych 500 ogłoszeniach.** Cel: CPV 49→95, „droga" 5→57 |
| **E2** | Naprawa utraty przetargów | P-4: pula kandydatów zamiast „tylko nowe" | Test: limit 1, 500 ogłoszeń, 3 kolejne przebiegi → 3 dopasowania |
| **E3** | Wzbogacenie danych | `bzp.js` + parser `htmlBody`; `tender_cpv`, province, city, order_type, parts, realizacja; backfill | 500 ogłoszeń → 100% ma province i ≥1 CPV |
| **E4** | Profil bez NIP + plany | Migracje 001/002 (NIP nullable + `CHECK` na 3 plany); `auth.js`; `lib/plans.js`; `createCheckoutSession({plan})`; webhook `price_id → tier` + **`customer.subscription.updated`**; **NIP w Stripe Checkout → Fakturownia** | E2E: rejestracja bez NIP; checkout Solo i Ekspert; zmiana planu aktualizuje konto; faktura wystawiona |
| **E5** | Nowy scoring | `scoreComponents`, wagi z sekcji 5.3, `score_breakdown`, filtry twarde | Golden set: 30 ręcznie ocenionych par (profil, przetarg) |
| **E6** | Pipeline 3-etapowy + AI re-rank | top-30, `S_final`, koszt zamknięty | Koszt AI/user/dzień ≤ $0,07 (z `ai_usage`) |
| **E7** | Dzisiejsze okazje | `daily_digest`, `jobs/buildDigest.js`, `GET /today` | Digest generowany dla 100 userów < 60 s |
| **E8** | Telemetria zachowań | `user_events`, `user_tender_state`, `POST /events`, backfill `feedback` | Zdarzenia lecą, backfill kompletny |
| **E9** | Mobile: onboarding + dashboard | Wizard 7 kroków, TodayScreen, tabs, swipe | Czas do pierwszej wartości < 90 s |
| **E10** | Personalizacja | `services/learning.js`, afinicje, adaptacyjne wagi, `user_weight_history` | Symulacja offline na `user_events`: trafność ↑ vs baseline |
| **E11** | Estymator wartości + wygrani | `jobs/fetchResults.js`, `tender_awards`, `tender_value_stats`, `value_estimate` | Pokrycie: ≥60% ogłoszeń z `confidence ≥ 0,3` |
| **E12** | Powiadomienia + gating | digest push, alerty 90%+, przypomnienia, egzekwowanie `lib/plans.js`, paywall 402 | Cisza nocna, limity, brak duplikatów |
| **E13** | **Plan Ekspert** | `services/analysis.js` (cache `tender_analysis`), `qualification.js`, `similar-awards`, kwota 50/mc | Koszt analizy ≤ $0,011; trafienie w cache > 40% przy 50 userach |
| **E14** | Eksploracja + insights | ε-greedy, `GET /me/insights`, tygodniowe podsumowanie | — |

**Ścieżka krytyczna:** `E0 → E1 → E3 → E5 → E6 → E7 → E9`.
E2, E4, E8 mogą iść równolegle. E10 wymaga E8 + ≥2 tygodni danych.

---

## 12. Priorytety wdrożenia

**Zasada:** najpierw naprawiamy to, co sprawia, że produkt **nie dowozi obietnicy**,
dopiero potem dodajemy nową obietnicę. Budowanie agenta AI na silniku, który gubi 48%
trafnych przetargów, to budowanie na piasku.

### P0 — krytyczne (bez tego produkt nie działa jak obiecuje)

| # | Zadanie | Etap | Dlaczego P0 |
|---|---|---|---|
| 1 | Runner migracji | E0 | **Blokuje wszystko inne.** Dziś nie da się dodać kolumny |
| 2 | Testy tras | E0 | Migracja bez siatki bezpieczeństwa = ruletka |
| 3 | Naprawa CPV (multi-kod) | E1 | 48% trafnych przetargów niewidocznych |
| 4 | Naprawa fleksji PL | E1 | 91% przetargów drogowych pomijanych |
| 5 | Naprawa utraty przetargów (P-4) | E2 | Free user traci 495/500 bezpowrotnie |
| 6 | Wzbogacenie: `tender_cpv`, province, order_type | E3 | Fundament pod lokalizację i branżę |
| 7 | Profil bez NIP + trzy plany + NIP w checkoucie | E4 | Bariera wejścia; **inaczej padną faktury**; webhook dziś nie umie zmienić planu |
| 8 | Nowy scoring ważony + `score_breakdown` | E5 | Rdzeń nowego produktu |
| 9 | Pipeline 3-etapowy (koszt AI zamknięty) | E6 | Bez tego AI re-rank rozjedzie budżet |
| 10 | `GET /today` + `daily_digest` | E7 | „Dzisiejsze okazje" = obietnica produktu |
| 11 | `user_events` + `user_tender_state` | E8 | Bez telemetrii agent nigdy się nie nauczy |
| 12 | Onboarding + dashboard mobilny | E9 | Persona nie dotrze do wartości bez tego |

### P1 — ważne (produkt jest dobry, ale nie jest jeszcze agentem)

| # | Zadanie | Etap |
|---|---|---|
| 13 | Afinicje cech + adaptacyjne wagi | E10 |
| 14 | Estymator wartości + `tender_awards` z `TenderResultNotice` | E11 |
| 14a | **Plan Ekspert**: streszczenie AI, dokumenty, „czy się kwalifikuję", historia wygranych | E13 |
| 15 | Digest push + alerty 90%+ + przypomnienia | E12 |
| 16 | Geokodowanie miast → prawdziwy promień | E3/E5 |
| 17 | Parser `htmlBody`: okres realizacji, `parts_count` | E3 |
| 18 | Explainability w UI („dlaczego to dopasowanie") | E9 |
| 18a | **Tryb ciemny/jasny do wyboru** + `userInterfaceStyle: automatic` | E9 |
| 19 | Słownik `clientType` → typ zamawiającego | E5 |
| 20 | Rozstrzygnąć los `landing/` (usunąć albo uzupełnić placeholdery prawne) | — |
| 21 | Deep link `przetargai://` ze stron `/upgrade/*` | — |

### P2 — rozwojowe (przewaga konkurencyjna)

| # | Zadanie |
|---|---|
| 22 | Eksploracja ε-greedy (ochrona przed bańką) |
| 23 | Embeddingi semantyczne zamiast rdzeni fleksyjnych |
| 24 | `GET /me/insights` + tygodniowe podsumowanie |
| 25 | Kalendarz terminów + eksport do iCal |
| 26 | Plan **Solo ~49 zł/mc** dla JDG (decyzja biznesowa) |
| 27 | Powiadomienia o ogłoszeniach o wyniku dla zapisanych („kto wygrał, za ile") |
| 28 | Podpowiedzi CPV z historii wygranych podobnych firm |
| 29 | Multi-profil (wykonawca prowadzi 2 branże) |

---

## 13. Ryzyka i decyzje do akceptacji

| # | Ryzyko / decyzja | Rekomendacja |
|---|---|---|
| **R1** | **Wartość przetargu nie istnieje w BZP.** Filtr min/max nie może działać na twardych danych | **PRZYJĘTE:** filtr miękki na estymacie z `tender_awards` + jawna komunikacja niepewności (sekcja 3.2). Gdy `confidence < 0,3` → komponent neutralny |
| **R2** | **Usunięcie NIP zepsuje faktury Fakturowni** | NIP zbierany w Stripe Checkout (`tax_id_collection`). Zadanie blokujące w E4 |
| **R3** | `tender.cpv` jako string → tablica to breaking change API | Zwracać `cpv` (string) **i** `cpv_list` przez jedną wersję mobile |
| **R4** | Rebuild `users` (usunięcie `NOT NULL`) na produkcji | 12-krokowa procedura SQLite w transakcji + kopia bazy przed migracją (mamy `services/backup.js` + B2) |
| **R5** | Monolit dzieli bazę z Fitter Welder Pro | Żadna migracja nie dotyka `fitter_*`. Runner migracji testowany na kopii prod |
| **R6** | Personalizacja może zamknąć usera w bańce | `S_base ≥ 90` nigdy nie filtrowane + eksploracja ε-greedy (P2) |
| **R7** | Adaptacyjne wagi mogą się rozjechać | Clamp ±40%, renormalizacja, zamrożenie do 20 zdarzeń, `user_weight_history` do rollbacku |
| **R8** | Koszt AI przy wielu userach | Pipeline 3-etapowy: **stały sufit 30 wywołań/user/dzień** ≈ $2/user/mc |
| **R9** | 199 zł/mc dla JDG | **ROZSTRZYGNIĘTE:** Zwiad (0) / Solo (49) / Ekspert (99). Ceny 199 i 399 archiwizowane w Stripe |
| **R10** | **Webhook nie obsługuje `customer.subscription.updated` dla PrzetargAI** (tylko dla Fittera). Przy dwóch płatnych planach zmiana Solo↔Ekspert nie zaktualizuje konta | Dodać obsługę w E4. Źródłem prawdy o planie jest `price_id` z subskrypcji, nie `metadata` |
| **R11** | Analizy AI planu Ekspert mogą wysadzić koszt | Leniwe generowanie + współdzielony cache `tender_analysis` + kwota 50/mc/konto + globalny `AI_BUDGET_HARD_USD` |
| **R12** | `createStandardInvoice` dostaje `user.company_nip` — po migracji może być `null` | Faktura bez NIP (osoba fizyczna) albo wstrzymana do czasu uzupełnienia. **Nie może rzucać wyjątkiem** |

---

## 14. Metryki sukcesu migracji

| Metryka | Baseline (dziś) | Cel po migracji |
|---|---|---|
| Trafne przetargi CPV rozpoznane (firma `45233000`) | 49 / 95 | **≥ 90 / 95** |
| Przetargi drogowe trafione słowem „droga" | 5 / 57 | **≥ 50 / 57** |
| Przetargi tracone przez konto Free (500 ogłoszeń) | 495 | **0** (odroczone, nie utracone) |
| Czas do pierwszej wartości (rejestracja → widzi okazję) | do 6 h | **< 90 s** |
| Pozycji do przejrzenia dziennie | do 500 | **3–10** |
| Koszt AI / user / miesiąc | nieograniczony | **≤ $2,10** |
| Trafność agenta (interesting / oceny) po 30 dniach | brak danych | **≥ 65%** |

---

## 15. Czego ten dokument świadomie nie robi

- **Nie przepisuje projektu.** Express, `node:sqlite`, repos, Expo, Stripe, magic link, BZP —
  wszystko zostaje. Największa pojedyncza zmiana to `lib/scoring.js`, ~200 linii czystych funkcji.
- **Nie usuwa `feedback`, `budget`, `company_nip`, `MatchFeedScreen`.** Deprecated ≠ usunięte.
- **Nie dotyka Fitter Welder Pro.**
- **Nie zawiera kodu** — zgodnie z ustaleniem, implementacja po akceptacji planu.

---

**Następny krok:** akceptacja planu, decyzja w sprawie **R1** (filtr wartości na estymacie)
i **R9** (plan cenowy dla JDG). Po akceptacji proponuję zacząć od **E0 + E1**, bo E1 daje
mierzalny skok jakości na istniejącym produkcie, jeszcze zanim powstanie jakikolwiek nowy ekran.
