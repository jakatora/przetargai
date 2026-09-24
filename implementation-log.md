# Dziennik wdrożeń — PrzetargAI

Dziennik **weryfikacji stanu wdrożonego**: co zostało zmierzone na żywo, kiedy i czym.
Uzupełnia dwa istniejące pliki, nie powiela ich:

- `agent_log.md` — narracja prac (co i dlaczego zrobiono),
- `decisions.md` — decyzje projektowe (D-0xx),
- `implementation-status.json` — ten sam stan w formie maszynowej.

Najnowsze wpisy na górze.

---

## 2026-09-24 — Etap 6: wygrywalność i przygotowanie oferty na danych z rozstrzygnięć

Wdrożone na Cloud Functions. Funkcji jest **10** — doszły `wynikiOknoFetch`
(okno rozstrzygnięć co 6 h) i `benchmarkPrzelicz` (przeliczenie benchmarku codziennie),
obie z `Successful create operation`.

Etap zaczął się od SONDY, nie od kodu — i to ją trzeba opisać najpierw, bo **trzy z czterech
założeń planu okazały się błędne**.

### Co obaliła sonda, zanim powstała pierwsza linijka

| Założenie | Co jest naprawdę |
|---|---|
| BZP ma osobne typy ogłoszeń dla udzielenia, unieważnienia i zmiany umowy | Działają dokładnie trzy typy: `ContractNotice`, `TenderResultNotice`, `ConcessionNotice`. Pozostałych 18 sprawdzonych wariantów → HTTP 400. Rozstrzygnięcie to JEDEN typ, a rozróżnia je pole `procedureResult` |
| Rabat względem kosztorysu da się policzyć z BZP | 4.3 jest NETTO (art. 28 Pzp), 6.4 zwykle BRUTTO. Mediana ilorazu na 46 ogłoszeniach = **1,0489**, skupiska dokładnie na 1,23 i 1,17 — to VAT, nie drożyzna rynku |
| `contractors[]` można zipować z blokami HTML po kolejności | Indeksem jest NUMER CZĘŚCI. Część nierozstrzygnięta ma wpis pusty i nie ma bloku, więc zipowanie po kolejności przypisuje firmie cudzą część |
| Tablice pól w TED są wzajemnie wyrównane | NIE są. `winner-size` ma długość równą liczbie części w 113/250 ogłoszeń |

### Co zmierzone na próbce 200 ogłoszeń BZP (2026-09-22)

| Fakt | Pomiar |
|---|---|
| Reguła „częścią jest blok z `5.1.)`" zgodna z `procedureResult` | **200/200** ogłoszeń (warianty „zawiera SEKCJA VI" 170/200, „liczba nagłówków" 164/200) |
| Bloki z niepustym `procedureResult[numer-1]` po indeksowaniu NUMEREM | **545/545** |
| Nazwa zwycięzcy z HTML zgodna z `contractors[numer-1]` | **395/395** (rozjazdów: 0) |
| Unieważnienia — dotąd niewidoczne w statystykach | **150 z 545 części (27,5 %)** |
| Ceny odzyskane po zdjęciu wymogu groszy | **+39 z 404 (9,6 %)** |
| Identyfikator postępowania (`tenderId`) — klucz złączenia wynik→przetarg | 200/200 wyników i **3974/3974** ogłoszeń o zamówieniu |

### Co zmierzone na żywym TED (250 i 500 ogłoszeń, 2026-09-24)

| Fakt | Pomiar |
|---|---|
| `winner-name` wyrównane do liczby części | 162/250 |
| `winner-size` wyrównane | **113/250** — reszta odcięta przez straż, i o to chodzi |
| `tender-value` wyrównane | 168/250 |
| `code.length === val.length` (pary ofert) | **250/250** |
| kody ofert podzielne przez liczbę części | 208/250 — reszta dostaje `null` zamiast liczby z cudzej części |
| `buyer-country-sub` w postaci NUTS | 250/250 (a `kodWojewodztwa('PL426')` dawał świętokrzyskie zamiast zachodniopomorskiego) |
| `procedure-identifier` obecny po obu stronach | 100/100 wyników i 250/250 ogłoszeń konkursowych; zapytanie po nim zwraca obie publikacje |
| Sonda dymna ingestu: 500 ogłoszeń | 0 odrzuconych, 1895 części, 922 z ceną, 151 unieważnionych, 895 ze zwycięzcą, 1918 z rodzajem w słowniku BZP |

### Dwa błędy znalezione przez TESTY, nie przez przegląd

1. **Kursor stronicowania rozstrzygnięć był samą DATĄ.** `opublikowano` nie jest unikalne
   (BZP publikuje setki dziennie), więc `startAfter` przeskakiwał WSZYSTKIE dokumenty z danego
   dnia i benchmark liczył się z ułamka rynku — po cichu, bo strona wracała pełna i bez błędu.
   Kursor to teraz para (data, docId).
2. **Strażnik indeksów Firestore miał lukę.** Wzorzec `[^)]*` zatrzymywał się na pierwszym
   nawiasie, więc `where('nip','==',String(nip))` w ogóle nie był dopasowany — czyli dokładnie
   ten kształt, który wymaga indeksu złożonego. Strażnik czyta teraz OKNO kodu do wykonania
   zapytania i sprawdza, czy indeks jest zadeklarowany, zamiast zakazywać wzorca w ogóle.

### Czego produkt NIE obiecuje

Karta „Czy warto startować?" **nie podaje prawdopodobieństwa wygranej** i nie poda.
Rozstrzygnięcia opisują rynek, nie konkretną ofertę. Werdykt jest kategorią, a treścią karty
są czynniki — każdy z liczbą i z wielkością próbki, z której powstała. Zakaz obowiązuje też
warstwę prezentacji: test czyta ŹRÓDŁO mobilnej biblioteki i pilnuje, żeby nie policzyła sobie
wskaźnika z tonów.

### Koszt policzony PRZED wdrożeniem, nie po rachunku

Dwie rzeczy skalowałyby się liniowo i przekroczyłyby darmowe limity Firestore, a job
kończyłby się przy tym sukcesem — czyli nikt by tego nie zauważył poza fakturą:

1. **Okno TED nadpisywało cały swój zakres przy każdym przebiegu.** BZP ma checkpoint
   dobowy, więc domknięta doba nie wraca; TED pytamy zakresem dat, nie dobami. Przy oknie
   7 dni i przebiegu co 6 h dawało to ~3 400 × 4 = **13 600 zapisów na dobę** z jednego
   zadania (limit darmowy: 20 000). Okno skrócone do 2 dni — przy czterech przebiegach
   dziennie każda publikacja i tak jest pokryta ośmiokrotnie.
2. **Benchmark utrwalał każdy kubełek, także bez wniosku.** Pomiar: 200 ogłoszeń jednego
   dnia to **178 RÓŻNYCH zamawiających**, więc w rocznym oknie uzbiera się ich dziesiątki
   tysięcy — a typowy urząd prowadzi kilka postępowań rocznie i nigdy nie przekroczy progu
   próbki. Utrwalamy wyłącznie kubełki z wnioskiem; odpowiedź się nie zmienia, bo
   `wybierzBenchmark` i tak pomija resztę, a karta mówi wtedy „za mało danych".
   Dodatkowo twardy sufit odczytu (30 000 rozstrzygnięć) ze ZGŁOSZENIEM ucięcia.

### Najważniejsze znalezisko etapu — na PRODUKCJI, nie w testach

Pierwszy prawdziwy import rozstrzygnięć oddał `bzp_ogloszen: 0` i `doby_bledne: 3`
przy `ok: true`. Powtórzenie zapytania ręcznie dało odpowiedź, której nie da się
zinterpretować inaczej:

```
HTTP 500 {"error":"The string 'undefined' was not recognized as a valid DateTime."}
```

`oknoDoby(dzien)` oddaje `{ publishedFrom, publishedTo }` — te same nazwy przyjmuje
`searchNotices`, którym idzie pobieranie OGŁOSZEŃ i dlatego ono działa. Ścieżka WYNIKÓW
(`zapytanieSurowe`) przyjmowała `{ from, to }`, a wołający robił
`zapytanieSurowe({ ...oknoDoby(dzien) })` — więc do adresu trafiało dosłowne
`PublicationDateFrom=undefined`.

**Pobieranie wyników postępowań z BZP nie zadziałało ANI RAZU od rundy 16.**
`aggregateResults` biegał co tydzień, łapał błąd per doba, agregował pustą listę
i kończył się `ok: true`. `GET /matches/:id/wyniki` zwracał `powod: 'brak_danych'` —
nieodróżnialne od „w tej branży nie ma jeszcze rozstrzygnięć".

Testy tego nie złapały, bo **wszystkie wstrzykiwały własny pobieracz doby**. Test, który
zastępuje jedyne miejsce, gdzie mieszka błąd, potwierdza wyłącznie sam siebie.
Naprawa: `zbudujUrlWynikow` wyeksportowany, rzuca przy braku okna czasu, a osobny plik
testów sprawdza ADRES — że niesie prawdziwe daty i nie zawiera „undefined".

Po naprawie, zmierzone na żywo: doba `2026-09-23` = **659 ogłoszeń w 13,1 s, 1404 części**,
0,9 MB po sparsowaniu, RSS 190 MB (limit instancji 512 MiB).

Druga naprawa z tej samej lekcji: przebieg uznawał się za udany, gdy przeszedł CHOCIAŻ
jeden rejestr — więc pełna awaria BZP dawała `ok: true`, bo TED przeszedł. Teraz awaria
całego rejestru = przebieg nieudany (ponowienie w Cloud Scheduler); pojedyncza zła doba
nadal go nie wywraca i zostaje otwarta w checkpoincie.

### Drugie znalezisko: filtr województwa ignoruje górną granicę okna

Przebieg okna zaraportował `bzp_ogloszen: 3601`, a benchmark policzony zaraz potem
przeczytał z bazy **2427** rozstrzygnięć. Pierwsza hipoteza („gubimy zapisy") była błędna.

Pomiar na żywym API, doba `2026-09-23`:

| wariant zapytania | n | rozkład `publicationDate` |
|---|---|---|
| samo okno doby | 500 (sufit) | 2026-09-23 = 500 |
| okno doby + `OrganizationProvince=PL14` | 127 | 2026-09-23 = 116, **2026-09-24 = 11** |
| pełna doba po docięciu 16 województw | 668 | 2026-09-23 = 564, **2026-09-24 = 104** |

Z 667 ogłoszeń „doby 23 września" **564 pojawiło się także w zapytaniu o 22 września**.
`OrganizationProvince` honoruje DOLNĄ granicę okna, a górną ignoruje — a docinanie po
województwach jest jedynym sposobem na dobę przekraczającą sufit 500.

Po odsianiu: doba 22.09 = 590 ogłoszeń (było 1154), doba 23.09 = 564 (było 667),
**0 ogłoszeń spoza doby**. Znika mniej więcej połowa zapisów do Firestore, które i tak
nadpisywały te same dokumenty, a licznik przebiegu zaczyna znaczyć to, co mówi.

### Co potwierdzone na produkcji (`api-00038-gip`)

| Sprawdzenie | Odczyt |
|---|---|
| `GET /wygrywalnosc/tender/:id`, `/benchmark`, `/matches/:id/czy-warto` bez tokenu | **401** (kontrolnie nieistniejąca trasa → **404**) |
| Okno rozstrzygnięć, przebieg domykający | 14/14 dób, **zaległość 0**, 2948 ogłoszeń BZP / 5250 części, 401 TED / 1550 części, 10 zmian umów |
| Budżet wyzwalacza operatora | przebieg 14 dób przekroczył 240 s i zostawił **3 doby OTWARTE**; kolejne wywołanie domknęło je w 76 s — checkpoint działa |
| Benchmark | 5 805 rozstrzygnięć, 12 stron, **3 488 kubełków policzonych, 932 utrwalone, 2 556 bez wniosku** (nieutrwalone) |
| `/health` | `wyniki_okno`: `doby_okna 14`, `doby_niedomkniete 0`, `error null` |

Karta na trzech ŻYWYCH ogłoszeniach z katalogu (konto sondujące bez słów kluczowych
i bez CPV, czyli zero wywołań płatnego AI; po pomiarach usunięte — `DELETE /auth/me` → 200,
kontrolnie `GET /auth/me` → 401):

| Ogłoszenie | Werdykt | Kubełek | Próbka | Co powiedziała karta |
|---|---|---|---|---|
| 2026/BZP 00453651 (żywność) | sprawdź | dział + region | 67 części | 93 % wygrywają mali, 1 % unieważnień, typowa cena 31 722 zł |
| 2026/BZP 00453649 (odpady) | sprawdź | dział + region | 18 części | zwykle **1 oferta**, 0 % unieważnień |
| 2026/BZP 00453647 (przepusty) | sprawdź | **zamawiający** | 16 części | 6 % unieważnień, typowa cena 121 770 zł |

Zejście z kubełka zamawiającego do działu w regionie zadziałało dokładnie tam, gdzie
zamawiający nie uzbierał progu próbki — czyli w dwóch przypadkach na trzy.

Checklista na żywo: dzień złożenia liczony z terminu (np. `2026-10-05` przy terminie
6 października), dokument ważny jeszcze 5 dni trafia do koszyka „straci ważność przed
złożeniem", następny krok = ZUS.

**Pułapka przy sprzątaniu:** `DELETE /auth/me` WYMAGA hasła w ciele żądania. Puste `{}`
daje 400 i zostawia konto sierotę — zdarzyło się przy pierwszym przebiegu i zostało
naprawione ręcznie (`/admin/users` → logowanie → DELETE z hasłem → 200, kontrolnie 401).
Skrypt `skrypty/weryfikacja-wygrywalnosci.mjs` ma to już poprawione.

---

## 2026-09-24 — Etap 5: monitoring szans i terminów (obserwacje, alerty, kalendarz)

Wdrożone na Cloud Functions, rewizja końcowa **`api-00034-jot`** (wcześniej `api-00031-nij`).
Funkcji jest **8** — doszła `monitorWyszukiwan` (`Successful create operation` w `api-00032-qec`).
Trzy wdrożenia w tej sesji, każde z powodu: `api-00032-qec` (etap), `api-00033-xac`
(naprawa cichej awarii sortowania — opis niżej), `api-00034-jot` (przypomnienie
włączane z kalendarza).
Mierzone na żywo kontem sondującym, które po pomiarach **usunięto** (`DELETE /auth/me`
→ 200, kontrolne `GET /auth/me` → 401). Konto zakładane BEZ słów kluczowych i BEZ kodów
CPV — dzięki temu ani jedno wywołanie płatnego AI nie padło.

### Co potwierdzone na produkcji

| Sprawdzenie | Odczyt |
|---|---|
| `GET /wyszukiwania`, `/alerty`, `/kalendarz`, `/kalendarz/ics` bez tokenu | **401** (kontrolnie nieistniejąca trasa → **404**) |
| Słownik częstotliwości | `godzinowa / dzienna / tygodniowa`, etykiety PL **i** EN obecne dla każdej |
| Limity oddane aplikacji | `{wyszukiwan: 20, alertow: 10, dlugosc_nazwy: 60}` |
| Normalizacja przy zapisie | `"  Roboty  drogowe BZP "` → `"Roboty drogowe BZP"`; `cpv: "45-000-000"` → `"45000000"`; `limit` wypada ze zbioru filtrów |
| Świeża obserwacja | `ostatnio_sprawdzone_o: null` — pierwszy przebieg ustawi punkt odniesienia |
| Duplikat DOKŁADNIE tych samych filtrów | **409**, `kod: "duplikat"`, `istniejaceId` wskazuje pierwszy wpis |
| Zapis bez nazwy | **400**, `kod: "brak_nazwy"` + gotowa propozycja: PL i EN `„TED · CPV 45000000"` |
| Limit włączonych alertów | 10 zapisanych z alertem → 11. odrzucony **409** `limit_alertow`; **ten sam zapis bez alertu → 201** |
| Edycja samej nazwy | **200** — filtry (`cpv: 39999999`) i częstotliwość nietknięte, brak fałszywego duplikatu |
| Usunięcie / powtórka | **200**, potem **404** |
| `GET /wyszukiwania/:id/podglad` | `count: 1`; po podglądzie `ostatnio_sprawdzone_o` nadal **null** — podgląd NIE konsumuje okna monitoringu |
| Centrum alertów (świeże konto) | `alerty: []`, `nieprzeczytane: 0`, słownik 7 typów zmian, 6 oznaczonych jako istotne |
| `GET /kalendarz/ics` | `content-type: text/calendar; charset=utf-8`, `content-disposition: attachment; filename="przetargai-terminy.ics"`, treść zaczyna się `BEGIN:VCALENDAR` |

### Kalendarz na ŻYWYM ogłoszeniu BZP (`2026~BZP_00446450`)

```
pytania    znany=True  zrodloDaty=wyliczony   1 października 2026, 10:00  | art. 284 ust. 2 Pzp
oferty     znany=True  zrodloDaty=ogloszenie  5 października 2026, 10:00  | (z rejestru)
zwiazanie  znany=True  zrodloDaty=wyliczony   4 listopada 2026, 09:00     | art. 220 ust. 1 pkt 1 Pzp
nastepny krok: pytania, za 7 dni
```

**Godzina 09:00 przy związaniu ofertą NIE jest błędem — to dowód, że strefa działa.**
Termin składania upływa 5 października o 10:00 czasu polskiego (czas letni, UTC+2).
Trzydzieści dni później jest już po zmianie czasu, więc ta sama chwila UTC to 09:00
czasu polskiego. Konwersja pilnuje CHWILI, nie napisu na zegarze.

### Kalendarz na żywym ogłoszeniu Bazy Konkurencyjności (`bk:261637`)

```
pytania    znany=False  →  „To postępowanie nie jest prowadzone na podstawie Prawa
                            zamówień publicznych, więc nie ma dla niego ustawowego…"
oferty     znany=True   →  15 października 2026, 09:00
zwiazanie  znany=False  →  (jak wyżej)
```

Czyli dokładnie to, o co chodziło w D-066: zamiast podstawić nieobowiązujący przepis,
produkt mówi wprost, czego nie wie i dlaczego.

### Błąd znaleziony i naprawiony PO pierwszym wdrożeniu (naprawa w `api-00033-xac`)

Podczas samodzielnego przeglądu kodu po deployu: harmonogram przepuszczał do zapytania
`sort` zapisany przez użytkownika. Wykrywanie nowości opiera się na `fetched_at`, więc
obserwacja z sortowaniem **„termin najbliżej"** dostawała stronę ogłoszeń o najbliższym
terminie — a świeżo pobranego wśród nich zwykle nie ma, bo jego termin jest odległy.

Zmierzone na emulatorze (52 ogłoszenia z terminem w styczniu 2027 + 1 nowe z terminem
w 2099, sufit skanu 50):

```
SORT=termin      wierszy=50  czyJestNOWY=0
SORT=najnowsze   wierszy=50  czyJestNOWY=1
```

**Awaria była CICHA** — obserwacja po prostu milczała, nie zgłaszając żadnego błędu.
Naprawa: harmonogram nadpisuje sortowanie na `najnowsze`. Jest to spójne z tym, że odcisk
obserwacji od początku pomija sortowanie (sortowanie to preferencja wyświetlania, nie
część obserwowanego zbioru).

**Pułapka w samym teście, warta zapamiętania.** Pierwsza wersja testu regresyjnego
PRZECHODZIŁA mimo obecności błędu: punkt odniesienia brał `Date.now() - 1000`, a zapis
52 ogłoszeń wypełniacza trwa dłużej niż sekundę — część wypełniacza wpadała więc do okna
nowości i test zieleniał z zupełnie innego powodu, niż mierzył. Dopiero ustawienie punktu
odniesienia PO wypełniaczu (bez cofania zegara) pokazało czerwień.

### Obietnica „alert w ≤ 6 h" — jak jest zabezpieczona

| Etap | Nośnik | Najgorszy przypadek |
|---|---|---|
| wykrycie zmiany | `bzpOknoFetch` (`20 */3`), `bkOknoFetch` (`50 */3`) | 3 h |
| powiadomienie | `monitorWyszukiwan` (`35 */2`) | 2 h |
| **razem** | | **5 h** |

Strażnik w `test/monitorWyszukiwan.test.js` czyta crony z `index.js` i liczy tę sumę.
Zweryfikowany przez celowe zepsucie: przy kadencji `*/6` test pada komunikatem
„najgorszy przypadek to 3 h wykrycia + 6 h powiadomienia = 9 h, a obiecujemy 6 h".

### Testy

| Zestaw | Przed etapem 5 | Po |
|---|---|---|
| backend (`firebase/functions`) | 606/606 | **744/744** |
| mobile | 711/711 | **739/739** + `npm run check` (esbuild) zielony |

### Czego świadomie NIE dowieziono

**Zapis pliku `.ics` z poziomu aplikacji.** Endpoint `GET /kalendarz/ics` jest gotowy,
przetestowany i zweryfikowany na produkcji, ale zapisanie pliku na urządzeniu wymaga
`expo-file-system` + `expo-sharing`, których w projekcie nie ma. Dołożenie zależności
to nowy build i weryfikacja na urządzeniu — osobna decyzja, poza tym etapem (D-066).
`Linking.openURL` nie jest tu rozwiązaniem: trasa wymaga nagłówka `Authorization`.

**Domknięcie kalendarza o przypomnienia (`api-00034-jot`).** Ekran pokazywał „zostały
3 dni", ale push o zbliżającym się terminie włączało się wyłącznie z ekranu „Zapisane".
`GET /kalendarz` niesie teraz stan przypomnienia w TRZECH stanach — `mozliwe` /
`wlaczone` / wyłączone — bo „przetarg niezapisany" to nie to samo co „przypomnienie
wyłączone", a przełącznik, który nic nie robi, jest gorszy niż jego brak. Zweryfikowane
na produkcji drugim kontem sondującym (również usuniętym): dla ogłoszenia niezapisanego
`{mozliwe: false, wlaczone: false, remind_at: null}`.

**Pomiar pierwszego realnego przebiegu `monitorWyszukiwan`.** Funkcja jest wdrożona,
ale jej cron (`35 */2`) nie odpalił się jeszcze w oknie tej sesji; nie było też konta
z obserwacją starszą niż odstęp częstotliwości (konto sondujące skasowano). Pierwszy
przebieg jest **oczekujący na harmonogram**, nie zmierzony.

---
## 2026-09-24 — Etap 4: katalog „Wszystkie", źródło na karcie, zakres danych, wyjaśnienie

Wdrożone na Cloud Functions, rewizja **`api-00031-nij`** (wcześniej `api-00028-xup`).
Mierzone na żywo kontem sondującym, które po pomiarach **usunięto** (`DELETE /auth/me`
→ 200, kontrolne `GET /auth/me` → 401). Konto było zakładane BEZ słów kluczowych
i BEZ kodów CPV — dzięki temu ani jedno wywołanie płatnego AI nie padło.

### Co potwierdzone na produkcji

| Sprawdzenie | Odczyt |
|---|---|
| `GET /tenders` bez tokenu | **401** (kontrolnie nieistniejąca trasa → 404) |
| `GET /tenders/zakres-danych` bez tokenu | **401** |
| Konto z PUSTYM profilem: `GET /matches` | `count: 0`, `podpowiedz.kod = "uzupelnij_profil"` |
| To samo konto: `GET /tenders?limit=3` | `count: 3` — katalog nie zależy od profilu |
| Metryczka źródła na karcie | `{kod: "bzp", stan: "ok", zsynchronizowano_o: "2026-09-24T01:27:04.561Z", rejestr: "https://ezamowienia.gov.pl"}` |
| Kursor: strona 1 → strona 2 | 5 + 5 różnych identyfikatorów, zero powtórzeń |
| Kursor z INNEGO zestawu filtrów | **400** |
| Kursor uszkodzony | **400** |
| `PATCH /auth/me` z `regiony: ["PL14","malopolskie","Berlin"]` | zapisane `["14","12"]` — „Berlin" odrzucony |
| `wartosc_max: 1500000` | zapisane i trwałe (odczyt `GET /auth/me`) |

### Filtry katalogu — pomiar na żywo

| Filtr | Wynik | Przeskanowano |
|---|---|---|
| bez filtrów, `limit=3` | 3 | **20** |
| `zrodlo=baza_konkurencyjnosci` | 5 | 20 |
| `zrodlo=baza_konkurencyjnosci&region=PL12` | 5 (wszystkie „Małopolskie") | 320 |
| `cpv=45` | 5 | 20 |
| `q=droga` | 5 | 791 |
| `sort=termin` | 5 (BZP i BK wymieszane) | 20 |

Wiersz `zrodlo=baza_konkurencyjnosci&region=PL12` jest tu najważniejszy: BK zapisuje
region NAZWĄ („małopolskie"), a BZP kodem TERYT („PL12"). Normalizator rozpoznający
wyłącznie cyfry — taki działał w aplikacji do dziś — zwracał dla BK `null`, więc filtr
województwa chował **całe źródło**: bez błędu, bez logu, po prostu mniej wyników.

### Dwie naprawy, które wyszły dopiero z pomiaru na żywo

**1. Koszt odczytu zależał od stałej, nie od zamówienia.** Pierwsze wdrożenie
(`api-00029-gap`) na żądanie o 3 pozycje czytało **300** dokumentów, bo pętla skanu
brała zawsze pełną stronę. Po naprawie (`rozmiarPobrania`: porcja z potrzeby
i ZMIERZONEJ trafności filtra w tym żądaniu) to samo żądanie czyta **20** — 15× taniej.
Testy jednostkowe tego nie mogły złapać: emulator z kilkudziesięcioma dokumentami
zwracał wszystko za pierwszym razem.

**2. Karta pokazywała „brak śladu pobrania" dla WSZYSTKICH źródeł** — choć okna BZP
i BK domknęły się tej samej nocy (01:27 i 01:50 UTC). Ślad dobowego cyklu pochodzi
sprzed naprawy lepkiego merge'a i nie ma historii per źródło, a checkpointy okien —
świeższe i niezależne — leżały obok nieużyte. Po naprawie:

```
bzp                    | stan: ok          | sukces 1,7 h temu | Okno 8 dób domknięte w całości.
ted                    | stan: brak_danych | sukces: null      | (TED nie ma własnego okna)
baza_konkurencyjnosci  | stan: ok          | sukces 1,3 h temu | Pobrano komplet: 1135 z 1135.
```

`ted: brak_danych` jest **poprawne i celowe**: TED nie ma własnej funkcji okna, więc
jego ślad pojawi się dopiero po pełnym przebiegu `dailyTenderFetch` (cron `0 12 * * *`).
Udawanie, że wiemy, kiedy TED ostatnio odpowiedział, byłoby dokładnie tym rodzajem
kłamstwa, któremu ten ekran ma zapobiegać.

### Testy

| Zestaw | Wynik | Baseline przed etapem 4 |
|---|---|---|
| `firebase/functions` (`npm test`, emulator Firestore) | **606/606** | 513/513 |
| `mobile` (`npm test`) | **711/711** | 663/663 |
| `mobile` (`npm run check`, esbuild) | zielony | zielony |

Środowisko emulatora bez zmian: `JAVA_HOME` = portable Temurin 21,
`JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\jtmp`.

### Czego NIE dało się zmierzyć na produkcji

Wyjaśnienia dopasowania na żywym koncie — każde konto z wypełnionym profilem
uruchamia przy zapisie ponowne dopasowanie, a to wywołuje **płatne AI**. Polecenie
etapu tego zabrania, więc wyjaśnienie zostaje pokryte testami (29 asercji: 19
jednostkowych na czystej funkcji + 10 przez realny serwer HTTP na emulatorze).
Sama funkcja jest czysta i nie ma gałęzi zależnej od środowiska.

---
## 2026-09-24 01:45 UTC — Audyt końcowy etapu 3 (Baza Konkurencyjności)

Zakres: **wyłącznie szybkie odczyty read-only z limitem 30 s**. Bez importów, bez pełnych testów.

### Git — potwierdzone

| Co | Odczyt |
|---|---|
| Gałąź | `codex/przetargai-complete` |
| Drzewo robocze | czyste (`git status` pusty) |
| HEAD | `1cf351d` — *Etap 3: stan wdrozenia, dziennik i decyzja D-058* |
| Commitów lokalnie przed zdalnym `main` | **16** |
| Zdalne gałęzie | tylko `refs/heads/main` @ `05c2f3d` — gałęzi `codex/*` na GitHubie **nie ma** |

Commity etapu 3 (od `ad4c2a8` w dół oraz dwa powyżej — wszystkie obecne w historii):

```
1cf351d  stan wdrozenia, dziennik, decyzja D-058
31e4cb5  7/7  awaria strony listy BK nie kasuje calego przebiegu
ad4c2a8  6/6  bezplatny wyzwalacz okna BK dla operatora
4fb47a9  5/6  BK w glownym pipeline: harmonogram, /health, rekonsyliacja
e0bbd6a  4/6  okno BK z checkpointem: aktywne/zmienione/anulowane
4fcd78d  3/6  deduplikacja MIEDZY rejestrami + link do zrodla pierwotnego
f7e5f06  2/6  adapter BK na fixture'ach kontraktowych
0fd1704  1/6  tempo i ponawianie zapytan jako wspolna biblioteka
```

### Produkcja — `/health` odpowiedział 200 w 0,21 s

```
status ok · db true · wersja api-00028-xup · otwarte_przetargi 10 084
```

Dwie rzeczy **rozjechały się** ze stanem zapisanym o 01:27 UTC — obie wyjaśnione, żadna nie jest usterką:

- **rewizja `api-00027-nez` → `api-00028-xup`** — po ostatnim wdrożeniu z lokalnego kodu,
- **8 384 → 10 084 otwartych przetargów** — przyrost 1 700 pochodzi z **okna BZP**
  domkniętego 01:27:04 UTC (`fetched 2512`, `newTenders 1700`, 8 dób okna, 0 dób niedomkniętych,
  `error: null`), a **nie** z BK.

`pula: {stan: "brak_pobrania"}` to licznik trzymany w pamięci instancji funkcji `api`
(`src/db/repos.js:324`) — zeruje się przy zimnym starcie. **Nie jest to awaria.**

### Ślady BK — cztery niezależne potwierdzenia

1. **Checkpoint w Firestore** `_health/bk_okno`, widoczny przez `/health`:
   zakończony 2026-09-24T01:38:20.868Z, `aktywne_w_zrodle 1135`, `aktywne_pobrane 1135`,
   `pokrycie_kompletne true`, `zaleglosc 0`, `error null`.
   Kluczowe: `fetched 0` / `newTenders 0` — **kolejne okno nie odpytało o żaden szczegół
   i nic nie dołożyło**, czyli checkpoint faktycznie działa, a nie tylko się zapisuje.
2. **Endpointy** — `POST` i `GET /admin/okno-bk` → **HTTP 403**, nie 404.
   403 znaczy „istnieje i jest chroniony kluczem administratora". Kontrolnie `/admin/okno-bzp` → 403.
3. **Funkcje** — `firebase functions:list`: **7/7 wdrożonych** (v2, nodejs22, europe-central2),
   w tym `bkOknoFetch`. Harmonogram `'50 */3 * * *'`, a przebieg z 01:38 UTC dowodzi,
   że wyzwala się planowo.
4. **Pliki w drzewie** — `services/bazaKonkurencyjnosci.js`, `jobs/oknoBk.js`,
   `lib/dedupZrodel.js`, `lib/tempoZapytan.js` + 4 fixtury kontraktowe `bk-*.json`.

Przy okazji sprawdzony most do Railway: `POST /api/api/przetarg/radar-planow/radar` → **401**
(a nie 404), czyli most żyje. Uwaga na ścieżkę — funkcja `api` serwuje `/health` bez prefiksu,
ale most montuje się pod `/api/przetarg`, więc pełny URL ma `api` **dwa razy**.
Pierwsza próba pod `/przetarg/...` dała 404 i była po prostu złym adresem.

### Testy — przyjęte z poprzedniej sesji, NIE powtórzone

**513/513** (`cd firebase/functions && npm test`), baseline przed etapem 3: 422/422.
Wykonane przez poprzednią sesję 2026-09-24. W tym audycie **nie uruchamiane** — zgodnie z poleceniem.
Etap dołożył 92 testy (tempoZapytan 9, bazaKonkurencyjnosci 22, dedupZrodel 16,
oknoBkCheckpoint 21, bkRepo 9, bkPipeline 8, zdrowieBk 5, adminOknoBk 2).

Środowisko wymagane do uruchomienia emulatora (inaczej testy nie wstaną):
`JAVA_HOME=C:/Users/Startklaar/.jdks/jdk-21.0.12.1+1` oraz
`JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\jtmp`.

### OCZEKUJĄCE — pełny przebieg głównego pipeline

`dailyTenderFetch` (wszystkie źródła + dopasowania AI) **nie ma świeżego wyniku**:

- ślad w `/health` pochodzi z 2026-09-23T10:04:27Z (15,7 h temu) i niesie flagę
  `slad_sprzed_naprawy: true`,
- ostatni wynik miał błędy źródeł: `bzp` — timeout, `ted` — HTTP 429,
- najbliższy slot: cron `'0 12 * * *'` → **2026-09-24 12:00 UTC (14:00 CEST)**.

Status: **oczekujący na harmonogram**. Nie czekaliśmy na wynik.

Warto rozdzielić dwie rzeczy: to okna 3-godzinne (`bzpOknoFetch`, `bkOknoFetch`) —
oba domknięte dziś czysto z `error: null` — potwierdzają żywotność źródła BK.
Stary ślad `dailyTenderFetch` nic o BK nie mówi, bo jest sprzed etapu.

### Blokady — zmierzone, nie założone

**1. GitHub — 16 commitów zostaje lokalnie.**
`git push --dry-run` kończy się na `could not read Username for 'https://github.com'`
(sesja nieinteraktywna, brak poświadczeń), `gh auth status` → niezalogowany,
`git ls-remote` widzi anonimowo tylko `main`.
Skutek: **Cloud Functions to nie blokuje** — wdrożenie idzie z lokalnego kodu i produkcja jest
aktualna. **Railway blokuje**, bo wdraża się z GitHuba.
Do odblokowania przez człowieka: poświadczenia git / `gh auth login` + uprawnienie `Contents: write`.
Ścieżka alternatywna: serwer MCP `github` jest w tej sesji uwierzytelniony jako `jakatora`
(`get_me` OK) — zapisu nie próbowano, bo audyt był read-only.

**2. Railway — wolumen 500 MB pełny, Live Resize do 2 GB.**
MCP `railway` zwraca `Not authenticated / Unauthorized`, więc **stanu wolumenu nie da się dziś
odczytać z tej sesji**. Blokada stoi niezmieniona, dotyczy backendu Railway, nie Cloud Functions.
Do odblokowania przez człowieka: Live Resize w panelu Railway.

### Sprzątanie

Brak plików `.probe` w drzewie (szukane rekurencyjnie) — nie było czego usuwać.
`firebase-debug.log` (gitignored, 239 B) również już nie istnieje.

---
