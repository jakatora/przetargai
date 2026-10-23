# PrzetargAI — „Mój pracownik” (projekt, 2026-10-23)

Status: **PROJEKT zaakceptowany w rozmowie 2026-10-23, część po części** — ten dokument
spisuje go w całości do ostatecznej akceptacji. Po niej: plan implementacji.

Poprzednik koncepcyjny: `plans/MIGRACJA-AGENT-AI.md` (2026-07-09, era Railway/SQLite) —
dziś nieaktualny technicznie; ten dokument go zastępuje w części „dopasowanie”.

---

## 0. Cel

**Słowa właściciela:** aplikacja ma działać jak pracownik firmy, która ją kupi — osobno dla
każdego klienta filtrować i wybierać przetargi, które naprawdę do niego pasują; wysyłać
powiadomienia, gdy pojawi się dopasowany przetarg; pomagać w wygraniu przetargu.

**Miara sukcesu (decyzja 2026-10-23, wariant A+C):**
1. Pracownik wybiera **tylko przetargi, na które firma realnie może startować** (precyzja
   przed kompletnością — lepiej 2 trafne niż 5 przypadkowych).
2. Pracownik **pokazuje swoją pracę**: ile przejrzał, co wybrał i dlaczego, co odrzucił
   i z jakiej przyczyny.

**Kryteria odbioru:**
- dla każdego wybranego przetargu widać 2–3 punkty uzasadnienia;
- każde odrzucenie ma przyczynę z zamkniętej listy (§4.3);
- raport dnia podaje liczby przejrzanych / wybranych / odrzuconych wg przyczyn / czekających;
- dzisiejszy feed starszej wersji aplikacji (1.1.4/1.1.5) działa dalej;
- koszt AI na klienta mieści się w szacunku z §8;
- `PRACOWNIK_ENABLED=false` przywraca dotychczasowe dopasowanie bez wdrożenia kodu.

## 1. Stan obecny (rozpoznanie 2026-10-23)

- `services/matching.js`: heurystyka (`lib/scoring.js`: słowa w TYTULE + CPV) rankuje całą
  pulę otwartych (~7–10 tys.) → Haiku 4.5 ocenia czołówkę świeżych (≤30/przebieg,
  10/dobę Free, 120/dobę Standard) → wynik ≥60 = dopasowanie; Free ≤5 dopasowań/dobę.
  Przebieg raz dziennie w `dailyTenderFetch` (12:00).
- AI widzi: nazwę firmy, słowa, CPV + tytuł, zamawiającego, CPV, budżet. Nie widzi regionu,
  skali, terminu, opisu firmy.
- `regiony` i `wartosc_max` są w profilu, ale świadomie NIE wchodzą do oceny (tylko
  `lib/wyjasnienieDopasowania.js`). Opis firmy nie jest zapisywany (tylko `suggest-profile`).
- 👍/👎 (`POST /matches/:id/feedback`) jest zapisywane i nieużywane. Zapisane/etapy też nie
  wracają do oceny. Odrzucone zostawiają w `evaluations` tylko liczbę punktów.
- Treść ogłoszenia (`htmlBody`) jest wyrzucana przy pobieraniu; zostaje meta (wadium,
  kryterium, liczba części, rodzaj, województwo).
- Pobieranie: BZP co 3 h (`bzpOknoFetch` :20), BK co 3 h (`bkOknoFetch` :50), TED raz
  dziennie (w `dailyTenderFetch`).
- Konta: 24, wszystkie Free (8 testowych). Push nie działa nigdzie (brak FCM V1 i APNs);
  e-mail przez Resend działa.

## 2. Zakres

**W zakresie:** karta firmy + kreator; lejek selekcji z przyczynami; dziennik pracy;
uczenie z sygnałów klienta + propozycje zmian karty; wyciąganie warunków udziału przy
pobieraniu (BZP/TED/BK) + porównanie z kartą (Standard); plan działania do wygranej
(Standard); powiadomienia (Free: mail dziennie; Standard: od razu, cisza nocna); ekrany
mobile; teksty planów w apce i na stronie; testy; deploy Functions; build 1.2.0.

**Poza zakresem:** zmiana cen; nowe źródła ogłoszeń; zmiany na Railway; klucze push
(dostarcza właściciel); opisy w sklepach (przy wysyłce); czytanie pełnej SWZ przez
pracownika (Radar SWZ zostaje osobnym narzędziem, do którego plan prowadzi).

## 3. Karta firmy

### 3.1 Model danych (`users/{id}`)

Istniejące pola zostają na swoim miejscu (zgodność wstecz): `company_name`, `keywords`,
`cpv_codes`, `regiony`, `wartosc_max`. Nowe pole-mapa `karta`:

| Pole | Typ / limit | Domyślnie | Rola |
|---|---|---|---|
| `karta.opis` | string ≤600 | `null` | zakres własnymi słowami → tylko AI |
| `karta.wykluczenia` | string[] ≤20, każdy 2–60 zn. | `[]` | twarda reguła na tytule + AI |
| `karta.wartosc_min` | number ≥0 \| null | `null` | twarda reguła „za małe” |
| `karta.min_dni_oferta` | int 1–60 | `5` | twarda reguła „za mało czasu” |
| `karta.formalne.obrot_roczny` | number \| null | `null` | porównanie warunków (Standard) |
| `karta.formalne.referencja_kwota` | number \| null | `null` | j.w. |
| `karta.formalne.referencja_opis` | string ≤200 \| null | `null` | j.w. |
| `karta.formalne.uprawnienia` | string[] ≤20, każdy ≤80 | `[]` | j.w. |
| `karta.zaktualizowano` | ISO | — | |

Teren = istniejące `regiony` (puste = cała Polska). Skala „do” = istniejące `wartosc_max`.

### 3.2 Wersja karty

`wersjaKarty(user)` = skrót SHA-256 (12 zn.) z: `keywords`, `cpv_codes`, `karta.opis`,
`karta.wykluczenia`, `regiony`, `karta.wartosc_min`, `wartosc_max`, `karta.min_dni_oferta`
(listy sortowane). Zastępuje dzisiejszy `criteriaHash` (który obejmował tylko słowa i CPV).
Zmiana wersji unieważnia stare decyzje → ponowna ocena otwartej puli (z hamulcem
`backfillCooldown` jak dziś). Część `formalne` NIE wchodzi do wersji karty — ma własny
skrót `wersjaFormalnych` dla pamięci porównań warunków (§6.2).

### 3.3 Kreator „Rozmowa wstępna” (mobile, 5 kroków, każdy do pominięcia)

1. Czym się zajmujesz? (opis → istniejące `POST /auth/suggest-profile` podpowiada słowa i CPV)
2. Czego nie bierzesz? (wykluczenia)
3. Gdzie pracujesz? (województwa)
4. Jakie kwoty i ile dni potrzebujesz na ofertę? (od–do, min. dni)
5. Obrót, największa referencja, uprawnienia (opcjonalnie; opis: „sprawdzę za Ciebie
   warunki udziału — w planie Standard”)

Wejścia: pasek „Uzupełnij kartę” na ekranie pracownika, Konto → „Karta firmy”, ekran po
rejestracji. Pola profilu z Konta przechodzą do Karty; Konto zostaje z linkiem i
przełącznikiem maili.

### 3.4 Migracja i zgodność

- Istniejące konta: bez akcji. Pracownik działa na tym, co jest (słowa/CPV); brakujące
  sekcje = reguły, które nie działają + pasek z prośbą o uzupełnienie.
- `PATCH /auth/me` bez zmian (starsze wersje apki). Nowe pola: `PUT /pracownik/karta`.
- Brak danych w ogłoszeniu ≠ odrzucenie (§4.3).

## 4. Praca pracownika (przebieg)

### 4.1 Harmonogram

| Kto | Kiedy | Funkcja |
|---|---|---|
| wszyscy | 12:00 (po pobraniu TED/BZP) | `dailyTenderFetch` → `pracujDlaWszystkich()` |
| tylko Standard | co 3 h, `10 2-23/3 * * *` (po oknach BZP :20 i BK :50) | nowa `pracownikCo3h` |

Pula pobierana RAZ na przebieg (jak dziś), kolejka od najdawniej obsłużonego, budżet
czasu 440 s, porcje po 5 użytkowników, awaria jednego nie zatrzymuje reszty (bez zmian).

### 4.2 Lejek dla jednego klienta

Wejście: otwarta pula. „Nowe” = przetargi z `fetched_at` późniejszym niż
`pracownik_ostatni_przebieg` klienta (pierwszy przebieg / zmiana wersji karty = cała pula).

1. **Sygnał tematyczny** — `heuristicScore` (bez zmian). Brak sygnału → licznik
   `branza` w dzienniku (tylko dla „nowych”; bez zapisu dokumentu).
2. **Twarde reguły** (czysta funkcja `lib/regulyPracownika.js`), dla świeżych kandydatów
   z sygnałem, w kolejności: `wykluczenie` → `teren` → `za_duze` → `za_male` → `termin`.
   Pierwsza trafiona = odrzucenie ostateczne z przyczyną i szczegółem.
3. **Ranking heurystyczny** tego, co przeszło.
4. **AI dla czołówki** — w granicach bezpieczników (§8): karta firmy + przykłady (§5.2)
   → werdykt (§4.4). Wybrany ⇔ `decyzja = "biore"` i `score ≥ MATCH_CONFIDENCE_THRESHOLD` (60).
5. **Limit Free:** ≤5 wybranych na dobę (`FREE_TIER_DAILY_MATCH_LIMIT`, bez zmian).
6. Kandydaci z sygnałem, do których AI nie doszło (limit) → licznik `oczekuje` (bez zapisu
   decyzji; wrócą w kolejnym przebiegu).

### 4.3 Przyczyny (zamknięta lista, wspólna dla reguł, AI i klienta)

| Kod | PL | Kto ją nadaje |
|---|---|---|
| `branza` | Nie Twoja branża | heurystyka (brak sygnału), AI, klient |
| `wykluczenie` | Na liście „nie bierzemy” | reguła |
| `teren` | Poza Twoim terenem | reguła, AI, klient |
| `za_duze` | Za duże dla Twojej firmy | reguła, AI, klient |
| `za_male` | Za małe | reguła, AI, klient |
| `termin` | Za mało czasu na ofertę | reguła, AI, klient |
| `warunki` | Warunki udziału nie do spełnienia | porównanie warunków (§6.2), AI, klient |
| `inne` | Inne | AI, klient (komentarz ≤140 zn.) |

Zasady reguł (gdy danych brak, reguła NIE odrzuca — pracownik dopisuje „nie wiem” do
uzasadnienia):
- `wykluczenie`: rdzenie fraz z `karta.wykluczenia` w tytule (`matchKeywords`, jak słowa
  kluczowe — „drogi” łapie „dróg”).
- `teren`: `regiony` niepuste i `kodWojewodztwa(tender.wojewodztwo)` znany i spoza listy.
- `za_duze`: `budget > wartosc_max`; gdy `budget` brak, a `wadium_kwota` jest:
  dolna granica wartości = `wadium_kwota / 0.03` (Pzp: wadium ≤3% wartości) > `wartosc_max`.
- `za_male`: `budget` znany i `< karta.wartosc_min`.
- `termin`: `deadline` znany i do terminu zostało `< karta.min_dni_oferta` dób.

### 4.4 Ocena AI (`services/ai.js` → nowa `ocenPrzetargDlaPracownika`)

- Model: `env.AI_MATCH_MODEL` (Haiku 4.5), `max_tokens` 300, timeout/ponowienia jak dziś.
- System: rola pracownika selekcjonującego przetargi dla tej firmy; dane przetargu w
  `<przetarg>…</przetarg>` jako dane, nie polecenia (jak dziś).
- Wejście: KARTA (nazwa, opis, słowa, CPV, wykluczenia, teren, skala od–do, min. dni),
  PRZYKŁADY (≤5 zapisanych: tytuł; ≤5 odrzuconych: tytuł — przyczyna), PRZETARG (tytuł,
  zamawiający, CPV, wartość lub „nieznana”, województwo, termin, rodzaj, wadium).
- Wyjście (JSON, parsowany obronnie jak `parseScore`):
  `{"decyzja":"biore"|"odrzucam","przyczyna":<kod z §4.3>|null,"punkty":[≤3 × ≤160 zn.],"score":0-100}`.
  Nieznana przyczyna → `inne`; brak punktów → punkty z heurystyki; nieczytelne → `null`.
- `aiUsage.record({operation: 'pracownik_ocena', …})` — osobna operacja w budżecie.
- `null` (AI wyłączone / twardy limit / błąd) → ocena heurystyczna jak dziś (≥60 =
  wybrany z flagą `ocena_bez_ai`), decyzja NIEostateczna (bez śladu) — jutro AI oceni.
  Gdy późniejsza ocena AI takiego dopasowania brzmi „odrzucam”, dopasowanie dostaje
  `odrzucony_przez_pracownika` z przyczyną AI i przechodzi do odrzuconych (ślad
  `decyzja='odrzucony'`, `etap='ai'`) — nie zostaje w „Wybranych” na samej heurystyce.

### 4.5 Zapis

| Dokument | Zmiana |
|---|---|
| `users/{id}/matches/{tenderId}` (wybrane) | + `uzasadnienie: string[]`, `ocena_bez_ai: bool`, `odrzucony_przez_klienta: {przyczyna, komentarz, o}\|null`, `odrzucony_przez_pracownika: {przyczyna, szczegol, o}\|null` (późniejsza ocena AI albo warunki — §4.4, §6.2), `warunki: {…}\|null` (§6.2); `match_reasoning` = punkty złączone (stara apka) |
| `users/{id}/evaluations/{tenderId}` | + `decyzja: 'wybrany'\|'odrzucony'`, `przyczyna`, `etap: 'regula'\|'ai'\|'warunki'`, `szczegol`; dla odrzuconych + `tytul`, `zamawiajacy`, `termin`, `wartosc`, `wojewodztwo`, `zrodlo`; `criteria_hash` = wersja karty |
| `users/{id}/dziennik/{RRRR-MM-DD}` (doba warszawska) — NOWE | `przejrzane`, `wybrane`, `oczekuje`, `odrzucone: {kod: liczba}`, `ai_wywolan`, `ostatni_przebieg_o`, `przebiegi: [{o, przejrzane, wybrane}]` (≤12); inkrementy `FieldValue.increment` |
| `users/{id}` | + `pracownik_ostatni_przebieg` (ISO) |

Indeks złożony: `evaluations` (`decyzja` ==, `evaluated_at` desc) — lista odrzuconych.
Lista pokazuje ostatnie 30 dni (filtr zapytania); retencja `evaluations` bez zmian.

## 5. Uczenie się

### 5.1 Sygnały klienta

- **Zapisz** (istnieje) → sygnał `zapis`.
- **Odrzuć** (nowe, `POST /pracownik/odrzuc/:matchId {przyczyna, komentarz?}`) →
  `matches.odrzucony_przez_klienta`, przetarg znika z „Wybranych”, sygnał `odrzucenie`.
- **„To jednak pasuje”** (Standard, na odrzuconym przez pracownika) →
  `POST /pracownik/przywroc/:tenderId` tworzy dopasowanie (bez limitu Free — i tak
  niedostępne na Free), ślad `decyzja='wybrany'`, sygnał `przywrocenie`.
- **👎 ze starej apki** (`/matches/:id/feedback {helpful:false}`) → jak odrzucenie z `inne`;
  👍 → jak `zapis` (bez tworzenia zakładki).

Sygnały: tablica `users/{id}.pracownik_sygnaly` (≤50 najnowszych, obcinana przy zapisie
w transakcji): `{typ, tender_id, tytul, przyczyna|null, komentarz|null, wojewodztwo|null,
wartosc|null, dni_do_terminu|null, o}`. Dokument użytkownika i tak jest czytany w przebiegu
→ uczenie nie dokłada odczytów.

### 5.2 Przykłady w ocenie AI

≤5 ostatnich `zapis`/`przywrocenie` (tytuły) i ≤5 ostatnich `odrzucenie` (tytuł —
przyczyna) trafiają do promptu od następnego przebiegu.

### 5.3 Propozycje zmian karty (czysta funkcja `lib/propozycjeKarty.js`, bez AI)

Liczone przy odczycie `GET /pracownik/dzien` z karty + sygnałów (ostatnie 30 dni).
Próg: ≥3 odrzucenia klienta z tą samą przyczyną.

| Przyczyna | Propozycja | Warunek dodatkowy |
|---|---|---|
| `branza` | dopisz do `wykluczenia` rdzeń słowa powtarzającego się w ≥3 tytułach odrzuconych | rdzenia nie ma w tytułach zapisanych ani w `keywords` |
| `teren` | `regiony` := województwa zapisanych przetargów | ≥2 znane województwa zapisanych; inaczej „wybierz teren” (otwiera kreator krok 3) |
| `za_duze` | `wartosc_max` := najmniejsza odrzucona kwota, zaokrąglona w dół do 2 cyfr znaczących | kwoty znane |
| `za_male` | `karta.wartosc_min` := największa odrzucona kwota, zaokrąglona w górę | kwoty znane |
| `termin` | `karta.min_dni_oferta` := maks. `dni_do_terminu` odrzuconych + 1 (≤60) | dni znane |
| `warunki` | „uzupełnij obrót i referencje” (otwiera kreator krok 5) | `formalne` puste |

Propozycja = `{klucz, pole, nowa_wartosc, opis{pl,en}, dowody: [tytuły ≤3]}`; `klucz` =
skrót (pole + wartość). `POST /pracownik/propozycje/:klucz {akcja: 'przyjmij'|'nie_teraz'}`:
przyjęcie zmienia kartę (nowa wersja → backfill); „nie teraz” → `users.pracownik_odlozone:
[{klucz, do}]`, nie wraca przez 30 dni.

## 6. Warunki udziału i plan działania (Standard)

### 6.1 Wyciąganie fragmentu warunków przy pobieraniu

Nowe pole przetargu `warunki_udzialu: {tekst ≤3000 zn., zrodlo: 'ogloszenie'|'swz'}|null`.

| Źródło | Skąd | Uwagi |
|---|---|---|
| BK | `orders[].order_items[].conditions[].description` (już pobierane w szczególe) | prawie zawsze dostępne |
| TED | nowe pole zapytania `selection-criterion-description-lot` (pol) | pomiar 2026-10-23: 8/40; gdy brak, a `selection-criteria-source` = `epo-procurement-document` → `{zrodlo:'swz'}` |
| BZP | sekcja „warunki udziału” z `htmlBody` (parser `lib/warunkiUdzialu.js`) | **FORMAT DO ZMIERZENIA NA ŻYWO** (e-Zamówienia w przerwie technicznej 2026-10-23 wieczorem); bez sekcji → `null` |

Przy okazji TED dostaje `wojewodztwo` z `buyer-country-sub` / `place-of-performance-subdiv-lot`
przez istniejące `kodWojewodztwaZNuts` (jak w `tedPlany.js`) — reguła terenu zaczyna
działać dla TED. Przetargi sprzed wdrożenia: `warunki_udzialu` brak → „warunki w ogłoszeniu/SWZ”.
`upsert` dopisuje `warunki_udzialu` raz, gdy dokument go nie ma (wzorzec backfillu meta).

### 6.2 Porównanie z kartą (`GET /matches/:id/warunki`)

- Tylko Standard (Free → `{warunki: null, powod: 'plan'}`), tylko dla dopasowań, tylko gdy
  `warunki_udzialu.tekst` jest i `formalne` niepuste; inaczej odpowiedź opisowa bez AI
  (`powod: 'brak_karty' | 'w_swz' | 'brak_tekstu'` + fragment, jeśli jest).
- Wynik zapamiętany w `matches.warunki` z `wersja_formalnych`; zmiana `formalne` = nowa
  ocena przy następnym otwarciu.
- Limit 20 nowych porównań/dobę/klienta (nowa `warunkiQuota`, wzór `streszczenieQuota`).
- AI zwraca: `{"werdykt":"spelniasz"|"nie_spelniasz"|"sprawdz","wymagania":[{"rodzaj":"obrot"|"referencje"|"uprawnienia"|"inne","wymog":"…","status":"ok"|"brak"|"nie_wiem","komentarz":"…"}]}`.
- Automatycznie w przebiegu Standard: dla nowo wybranych z tekstem warunków i kartą
  formalną (w ramach tego samego limitu 20). `nie_spelniasz` → dopasowanie dostaje
  `odrzucony_przez_pracownika: {przyczyna:'warunki', szczegol}` (+ ślad
  `decyzja='odrzucony'`, `etap='warunki'`, licznik `warunki` w dzienniku), znika z „Wybranych”,
  ląduje w odrzuconych z podpowiedzią „można z partnerem” (Kreator 118, Konsorcjum).
- `aiUsage.record({operation: 'pracownik_warunki'})`.

### 6.3 Plan działania (mobile, bez AI)

Nowa czysta `mobile/src/lib/planDzialania.js` buduje plan z istniejącej
`lib/sciezkaDoOferty.js` (KROKI → ekrany) + terminów z `lib/kalendarzPrzetargu.js`
(termin pytań: art. 284 ust. 2 / art. 135 ust. 2 Pzp; BK bez reguły = bez terminu) +
danych przetargu (wadium, kryterium) + stanu klienta (etap warsztatu, powiązana SWZ).

| Krok | Termin | Ekran |
|---|---|---|
| Zdecyduj, czy startujesz | dziś | `CzyWarto` / `KartaDecyzji` |
| Wklej SWZ | od razu | `RadarSwz` (odhaczone, gdy SWZ powiązana) |
| Zadaj pytania do SWZ | termin pytań | `KalendarzTerminow` |
| Sprawdź ważność dokumentów | przed terminem ofert | `Sejf` |
| Wnieś wadium X zł | gdy `wadium_wymagane` | `KontrolerGwarancji` |
| Policz cenę (i punkty) | przed terminem | `KalkulatorCeny` / `KalkulatorPunktow` gdy nie tylko cena |
| Sprawdź ofertę | dzień przed terminem | `KontrolaOferty` |
| Złóż i nagraj dowody | dzień terminu | `RejestratorOferty` |

Free: podgląd zablokowany „w Standard”.

## 7. Powiadomienia

- **Free:** jeden mail dziennie po przebiegu 12:00, tylko gdy ≥1 wybrany. Temat
  „Twój pracownik wybrał dziś N przetarg(i/ów)”; treść: tytuł, zamawiający, termin,
  2 punkty; linia raportu dnia; przycisk do apki. Znacznik `znacznikPracownika`
  (wzór `znacznikDigestu`: rezerwuj → wyślij → potwierdź/zwolnij) na (użytkownik, doba).
  Push „Nowe dopasowane przetargi” jak dziś (zadziała po kluczach).
- **Standard:** po każdym przebiegu z nowymi wybranymi → `dostarcz()` z
  `jobs/monitorWyszukiwan.js` (push → przy porażce/braku tokenu mail) + wpis w Centrum
  alertów (`alerty.dodaj`). Mail jak Free + pierwszy krok planu.
- **Cisza nocna 21:00–7:00 (Warszawa):** przebiegi nie wysyłają; wybrane mają
  `notified: 0` i trafiają do zbiorczego powiadomienia z pierwszego przebiegu po 7:00.
  Wysyłamy wyłącznie dopasowania z `notified: 0`; po dostawie `markNotifiedBatch`.
- **Wypis:** `users.powiadomienia_pracownik_email` (domyślnie `true`), przełącznik w
  Koncie; link w stopce → `GET /pracownik/wypisz?token=` (istniejące `magicLinks`,
  cel `wypisz_pracownik`, TTL 30 dni, strona HTML z potwierdzeniem).
- Odrzucony adresat Resend → jak dziś (`czyOdrzuconyAdresat`): bez ponowień.
- `weeklyDigest` bez zmian.

## 8. Plany i koszt

| | Free | Standard (99 zł/mc brutto) |
|---|---|---|
| Przebieg | raz dziennie 12:00 | 12:00 + co 3 h |
| Twarde reguły, karta firmy | tak | tak |
| Wybrane | ≤5/dobę | bez limitu |
| Raport dnia z licznikami przyczyn | tak | tak |
| Lista odrzuconych + „To jednak pasuje” | nie (liczby + „w Standard”) | tak |
| Ocen AI na dobę (bez zmian) | 10 | 120 |
| Porównanie warunków udziału | nie (fragment + „w Standard”) | tak, ≤20/dobę |
| Plan działania | podgląd zablokowany | tak |
| Powiadomienia | mail raz dziennie (+push) | od razu (push → mail), cisza nocna |

Szacunek (Haiku 4.5, $1/$5 za Mtok): ocena pracownika ~700 tok. wej. + ~120 wyj. ≈
0,0013 USD (dziś ~0,0007 — dochodzi karta i przykłady); porównanie warunków ~1300 + 300
≈ 0,0028 USD. Najgorszy przypadek Standard: 120 × 0,0013 + 20 × 0,0028 ≈ 0,21 USD/dobę
≈ 6,4 USD/mc; realnie (kilkadziesiąt kandydatów/dobę) 1–2 USD/mc. Free: ≤0,4 USD/mc.
Bezpieczniki bez zmian: `AI_RERANK_TOP_N` na przebieg, `aiQuota` na dobę, miesięczny
miękki/twardy limit (`AI_BUDGET_*`) — obejmuje nowe operacje.

Teksty: opis Standard w apce (ekran zachęty/upgrade) i na stronie (`landing/index.html`)
dostaje punkty: „pracownik przegląda co 3 h i powiadamia od razu”, „sprawdza warunki
udziału”, „plan działania do wygranej”. Obietnica „Free: 5 dopasowań dziennie” zostaje.

## 9. API (Functions, nowy router `routes/pracownik.js`, `authRequired`)

| Metoda i ścieżka | Odpowiedź / działanie | Plan |
|---|---|---|
| `GET /pracownik/dzien` | `{raport: {dzis, ostatni_przebieg_o, nastepny_przebieg_o}, wybrane: [match + uzasadnienie + wyjasnienie], odrzucone: {wg_przyczyny, lista_dostepna}, propozycje, braki_karty, plan}` | oba |
| `GET /pracownik/odrzucone?przyczyna=&before=` | strona odrzuconych (30 dni, kursor) | Standard (Free → `powod:'plan'`) |
| `POST /pracownik/odrzuc/:matchId` | `{przyczyna, komentarz?}` → odrzucenie przez klienta | oba |
| `POST /pracownik/przywroc/:tenderId` | „To jednak pasuje” | Standard |
| `GET /pracownik/karta`, `PUT /pracownik/karta` | odczyt/zapis karty (zod); zmiana wersji → backfill | oba |
| `POST /pracownik/propozycje/:klucz` | `{akcja}` | oba |
| `GET /matches/:id/warunki` | §6.2 | Standard |
| `GET /pracownik/wypisz?token=` | HTML, bez logowania | — |
| `PATCH /auth/me` | + `powiadomienia_pracownik_email` (bool) | oba |

Plan egzekwowany na serwerze. „Wybrane dziś” = dopasowania z `created_at` w bieżącej dobie
warszawskiej bez `odrzucony_przez_klienta`/`odrzucony_przez_pracownika`; historia = istniejące
`GET /matches` (dostaje te same nowe pola, odfiltrowuje odrzucone przez klienta).

## 10. Mobile (Expo RN, `mobile/src`)

- **`MatchFeedScreen` → „Mój pracownik”** (nazwa trasy `MatchFeed` zostaje — linki z push):
  raport dnia; pasek „Uzupełnij kartę”; propozycje (Przyjmij / Nie teraz); „Dziś wybrane”
  (karta z punktami, Zapisz, Odrzuć → arkusz przyczyn); „Odrzucone (N)” zwinięte, grupy wg
  przyczyn (Standard: lista + „To jednak pasuje”; Free: liczby + „w Standard”);
  „Wcześniej” = obecna lista z filtrami/sortem. Pas podprogowy i zachęta Free zostają.
- **`MatchDetailScreen`:** sekcje „Dlaczego to wybrałem”, „Warunki udziału”, „Plan działania”;
  Odrzuć zamiast 👍/👎.
- **`KartaFirmyScreen`** (nowy, kreator §3.3) + rejestracja w `RootNavigator`.
- **`AccountScreen`:** sekcja profilu → link „Karta firmy”; przełącznik „Maile od pracownika”.
- Czyste moduły z testami (`node --test`): `lib/pracownik.js` (etykiety przyczyn PL/EN,
  raport → zdania z odmianą, grupowanie odrzuconych), `lib/kartaFirmy.js` (walidacja, braki,
  kroki kreatora), `lib/planDzialania.js` (§6.3).
- `api/client.js`: `pracownikDzien`, `pracownikOdrzucone`, `pracownikOdrzuc`, `pracownikPrzywroc`,
  `kartaFirmy`, `zapiszKarteFirmy`, `propozycjaKarty`, `warunkiUdzialu`.
- Wszystkie nowe teksty `context.tr(pl, en)`; kolory tylko z `motyw.js`.

## 11. Przełącznik, wdrożenie, wersje

- `PRACOWNIK_ENABLED` (`'true'|'false'`, domyślnie `'true'`): `false` → stary
  `generateMatchesForUser` (zostaje w kodzie bez zmian), `pracownikCo3h` nic nie robi,
  `/pracownik/*` zwraca `503 {powod:'wylaczony'}`; apka 1.2.0 wraca wtedy do starej listy.
- Kod w `D:\wt\przetargai-pracownik`, gałąź `feat/pracownik` z `integ/1.1.2` (w drzewie
  `przetargai-release` leżą cudze, niezacommitowane zmiany — nie mogą trafić do builda).
- Kolejność: (1) Functions — zgodne wstecz; deploy `api`, `dailyTenderFetch`,
  `bzpOknoFetch`, `bkOknoFetch`, nowa `pracownikCo3h` + indeksy Firestore; Railway bez
  zmian. (2) Apka **1.2.0 / vc18**: Android AAB+APK lokalnie, iOS Codemagic (wymaga
  pushu na `main` — pójdą też wiszące commity 1.1.5 i alarmu AI), Windows (eksport web +
  electron-builder). (3) Strona: tekst Standard.

## 12. Testy

- **Functions — czyste moduły:** `regulyPracownika` (każda reguła, brak danych ≠
  odrzucenie, granica wadium/0,03), `wersjaKarty`, prompt + `parsujWerdykt` (śmieci,
  nieznana przyczyna, za długie punkty), `propozycjeKarty` (progi, warunki dodatkowe,
  odłożone), `warunkiUdzialu` (BK z fixture, TED z fixture, BZP z fixture zmierzonego na
  żywo), raport/dziennik (doba warszawska), cisza nocna.
- **Functions — emulator:** pełny lejek z udawanym AI (wybrane/odrzucone/oczekuje, limit
  Free, flaga `ocena_bez_ai` przy awarii AI), dziennik inkrementowany, powtórzony przebieg
  bez podwójnych maili, blokady planu na trasach, IDOR na odrzuć/przywróć/warunki,
  `PRACOWNIK_ENABLED=false`. Cały dotychczasowy zestaw zielony (znany flaky
  `radarPlanowRoute` „pusty profil” — osobno).
- **Mobile:** testy czystych modułów + kompilacja kontrolna (esbuild) ekranów.
- **Po wdrożeniu (produkcja):** konto testowe z kartą firmy → ręczny przebieg (admin) →
  `GET /pracownik/dzien` zgodny z dziennikiem → mail na adres właściciela.

## 13. Ryzyka i otwarte kwestie

- **Format BZP `htmlBody` (warunki)** niezweryfikowany — pierwsze zadanie implementacji
  to zmierzenie na żywo i fixture; gdy sekcji brak/nieczytelna → `null` (nie zgadujemy).
- **Push** nie działa do czasu kluczy FCM V1 + APNs (właściciel) — e-mail to kanał
  podstawowy.
- **Kredyty Anthropic wspólne dla organizacji** — bezpieczniki + alarm `/health`
  (`f090408`) obejmują nowe operacje.
- **Pierwszy przebieg po wdrożeniu** = „przejrzałem cały rynek” (~7–10 tys.) — prawdziwe,
  ale raport pierwszego dnia będzie nietypowy; AI ograniczone dobowymi limitami.
- **Stara apka** pokazuje dopasowania odrzucone przez klienta w nowej apce (inna lista) —
  akceptowalne, znika po aktualizacji.
