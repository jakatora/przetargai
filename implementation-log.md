# Dziennik wdrożeń — PrzetargAI

Dziennik **weryfikacji stanu wdrożonego**: co zostało zmierzone na żywo, kiedy i czym.
Uzupełnia dwa istniejące pliki, nie powiela ich:

- `agent_log.md` — narracja prac (co i dlaczego zrobiono),
- `decisions.md` — decyzje projektowe (D-0xx),
- `implementation-status.json` — ten sam stan w formie maszynowej.

Najnowsze wpisy na górze.

---

## 2026-09-24 — Etap 5: monitoring szans i terminów (obserwacje, alerty, kalendarz)

Wdrożone na Cloud Functions, rewizja **`api-00032-qec`** (wcześniej `api-00031-nij`).
Funkcji jest **8** — doszła `monitorWyszukiwan` (`Successful create operation`).
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

### Błąd znaleziony i naprawiony PO pierwszym wdrożeniu (rewizja `api-00032-qec`)

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
| backend (`firebase/functions`) | 606/606 | **741/741** |
| mobile | 711/711 | **737/737** + `npm run check` (esbuild) zielony |

### Czego świadomie NIE dowieziono

**Zapis pliku `.ics` z poziomu aplikacji.** Endpoint `GET /kalendarz/ics` jest gotowy,
przetestowany i zweryfikowany na produkcji, ale zapisanie pliku na urządzeniu wymaga
`expo-file-system` + `expo-sharing`, których w projekcie nie ma. Dołożenie zależności
to nowy build i weryfikacja na urządzeniu — osobna decyzja, poza tym etapem (D-066).
`Linking.openURL` nie jest tu rozwiązaniem: trasa wymaga nagłówka `Authorization`.

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
