# Przetarg → pierwsza analiza SWZ → checklista (2026-10-03, runda 2)

Worktree `D:/wt/przetargai-release`, gałąź `integ/1.1.2`, baza `6ccae33`.
Stan: **zmiany w drzewie roboczym — bez commita, pusha, deployu i buildów sklepowych.**
Pamięć nietknięta. Zmiany z rundy 1 (`plans/PIERWSZA-OFERTA-2026-10-03.md`) zachowane; ten raport
zamyka jej ograniczenia nr 1–3 (luka backendu, brak automatycznego powiązania, sitemap/robots).

## 1. Co zostało zrobione

### Backend (Railway, `backend/`)

Problem: `POST /api/przetarg/swz/postepowania/:id/analiza` oddawało wklejoną SWZ płatnemu AI i jej
nie zapisywało. Dopasowanie sejfu (a przez nie checklista) czytało treść tylko z `swz_wersja`,
którą zapisuje wyłącznie `/odswiez`. Po pierwszej analizie checklista nie znała żadnych wymagań,
a przy awarii lub limicie AI treść przepadała.

| Plik | Zmiana |
|---|---|
| `src/db/migrations/015_swz_tresc_wklejona.sql` (nowy) + `src/db/schema.sql` | Nowa tabela `swz_tresc_wklejona` (`postepowanie_id` = klucz główny, FK z kaskadą, `hash`, `tresc`, `created_at`). Sama `CREATE TABLE IF NOT EXISTS`, żadnej istniejącej tabeli nie dotyka. |
| `src/db/repos.js` | `swzTrescWklejona.zapiszPierwsza()` — jedno zdanie SQL: `INSERT … SELECT … WHERE NOT EXISTS (wersja opublikowana) ON CONFLICT DO NOTHING`. |
| `src/services/trescSwz.js` (nowy) | `zapamietajWklejonaSwz`, `trescSwzPostepowania`, `stanTresciSwz`. Pierwszeństwo: wersja opublikowana → treść wklejona → brak. |
| `src/routes/radarSwz.js` | `/analiza` zapamiętuje SWZ **przed** wywołaniem AI (po sprawdzeniu właściciela i limitów rozmiaru). Błąd AI (503/429) niesie `error.details.tresc_swz`. Odpowiedź 201 i `GET /postepowania/:id` oddają `tresc_swz: { zrodlo, zapisana_at }` (bez samej treści). Szkice pytań o identycznej treści nie są dopisywane drugi raz. |
| `src/routes/sejfDokumentow.js` | Dopasowanie bez `swz` w body bierze treść z `trescSwzPostepowania`. Odpowiedź dostała `zrodlo_swz` (`zadanie`/`lista`/`wersja`/`wklejona`/`brak`) i `wymagania_heurystyczne`. |
| `test/analizaSwzTrescDoChecklisty.test.js` (nowy) | 17 testów (niżej). |
| `test/migracjaProdukcji.test.js` | Migracja 015 na liście + test kształtu nowej tabeli. |

Decyzje projektowe:

- **Osobna tabela zamiast wiersza `swz_wersja`.** `swz_wersja` to wersje opublikowane przez
  zamawiającego (`data_publikacji NOT NULL`, baza silnika różnic). Wklejona treść bywa fragmentem;
  jako „wersja" dostałaby datę publikacji, której nie ma, a kolejna prawdziwa publikacja porównana
  z nią dałaby fałszywą „opublikowaną zmianę". Teraz analiza nie tworzy ani wersji, ani wpisu zmiany.
- **Pierwsza treść wygrywa.** Ponowienie, spóźnione żądanie i wyścig niczego nie nadpisują i nie
  dublują. Nowszą treść podaje się przez `/odswiez` („Sprawdź publikacje zamawiającego") — wersja
  opublikowana ma zawsze pierwszeństwo przed wklejoną.
- **Istniejąca wersja opublikowana blokuje zapis wklejonej** — warunek i zapis są atomowe w jednym SQL.
- Functions (`firebase/functions`) — **bez zmian**; aplikacja używa istniejącego
  `PUT /wygrywalnosc/tender/:id/swz`.

### Aplikacja (`mobile/`)

| Plik | Zmiana |
|---|---|
| `src/lib/sciezkaDoOferty.js` | `parametryNarzedzia('RadarSwz')` przekazuje też `tenderId`. |
| `src/lib/radarSwz.js` | `wstepneDaneRadaru` oddaje `tenderId`; nowe czyste funkcje: `potwierdzonePowiazanie`, `opisPowiazania`, `opisTresciSwz`, `podpowiedzPustegoDopasowania`. |
| `src/lib/wygrywalnosc.js` | Nowy stan wymagań `brak_tresci` (analiza nie ma treści SWZ) obok `brak_wymagan` (treść jest, parser nic nie rozpoznał) + komunikat PL/EN. |
| `src/screens/RadarSwzScreen.js` | Po „Dodaj do radaru" z przetargu aplikacja sama woła `api.powiazSwz`. Sukces dopiero po potwierdzeniu, że serwer zapisał **tę** analizę; błąd zostaje na ekranie z powodem i przyciskiem „Ponów powiązanie". Karta powiązania z wejściem do checklisty. Stan „treść SWZ zapisana" pokazywany tylko, gdy serwer go potwierdzi (po nieudanej analizie panel jest czytany ponownie). Nowe podpowiedzi przy pustym dopasowaniu; przy koszykach sejfu dopisek o niepełności listy. |
| `src/screens/ChecklistaOfertyScreen.js` | Radar otwierany z kontekstem przetargu (dotąd `navigate('RadarSwz')` bez niczego). Przycisk „Dodaj SWZ w Radarze". Osobne komunikaty dla „brak treści SWZ" i „nic nie rozpoznano". Odświeżanie po powrocie na ekran. Ostrzeżenie o niepełnej liście heurystycznej zostało. |
| `test/radarSwzPowiazanie.test.js` (nowy), `test/sciezkaNawigacja.test.js`, `test/radarSwzWstepne.test.js` | 16 nowych testów + aktualizacja dla `tenderId`. |

### Strona (`landing/`)

| Plik | Zmiana wobec produkcji |
|---|---|
| `sitemap.xml`, `robots.txt` | Domena `przetargai.web.app` (na produkcji `przetarg-ai.pl`); poza tym identyczne. |
| `pobierz.html` | Zrównany z produkcją bajt w bajt (źródło w gicie było starsze: 1.0.8, „iPhone wkrótce"). |
| `index.html` | Runda 1 + teraz: licznik bez liczby zastępczej („300+" usunięte — liczba i opis „na żywo" pojawiają się razem, tylko po udanym pobraniu); usunięte obietnice powiadomień push poza cennikiem; „Śledzenie zmian w SWZ" → porównanie wersji, które użytkownik wklei; FAQ i JSON-LD wymieniają trzy rejestry; w stopce link do Bazy Konkurencyjności. |
| `mobile/test/landingStrona.test.js` | 14 testów (było 9). |

Nietknięte: cennik, regulamin, polityka prywatności, płatności, faktury, konfiguracja hostingu, `styles.css`.

## 2. Wyniki

| Sprawdzenie | Wynik |
|---|---|
| `backend`: `npm test` przed zmianami | 1026 testów, 1025 PASS, **1 FAIL zastany** (`smartspizarkaPricesVerifiedOffer.test.js:175` — inny moduł, nie ruszany) |
| `backend`: `npm test` po zmianach | 1044 testy, **1043 PASS**, ten sam 1 FAIL zastany; 18 nowych testów PASS |
| `backend`: pierwsza SWZ → dopasowanie bez body zna wymagania | PASS |
| `backend`: AI 503 (błąd modelu), 503 (brak konfiguracji), 429 (limit dobowy) — treść zostaje, dopasowanie działa | PASS |
| `backend`: ponowienie — jeden wiersz, szkice bez duplikatów | PASS |
| `backend`: 8 równoległych analiz różnych treści — jeden spójny zapis | PASS |
| `backend`: istniejąca wersja opublikowana nietknięta, zero zapisu wklejonej | PASS |
| `backend`: wklejona → publikacje: pierwsza publikacja bez fałszywej zmiany, zmiana dopiero między publikacjami | PASS |
| `backend`: obcy właściciel — 404 na analizie, panelu i dopasowaniu, zero zapisu, AI niewołane | PASS |
| `backend`: limit rozmiaru — 413, zero zapisu, AI niewołane | PASS |
| `backend`: kaskada przy usunięciu postępowania; migracja 015 na „bazie produkcyjnej" i idempotencja | PASS |
| Kontrakt analiza → dopasowanie → `wymaganiaZDopasowania` (aplikacja) → `zbudujChecklisteOferty` (Functions) | PASS (prawdziwe funkcje trzech pakietów, bez sieci) |
| `mobile`: `npm test` | **PASS — 1128/1128** |
| `mobile`: `npm run check` | **PASS** — kod 0 |
| `firebase/functions`: `test/checklistaOferty.test.js` (czysta logika, bez emulatora) | PASS — 24/24 |
| `firebase/functions`: testy z emulatorem (`powiazanieSwz`, `wygrywalnoscRoute`) | **NIEURUCHAMIANE** — kod Functions bez zmian; `powiazanieSwz.test.js` włącza most (na atrapę loopback), co wykracza poza warunek „most wyłączony" |
| Ekrany na urządzeniu / w przeglądarce | **NIEZWERYFIKOWANE** |
| Wygląd strony w przeglądarce | **NIEZWERYFIKOWANE** (skrypt licznika woła produkcyjne API) |
| Zachowanie na produkcji (Railway, Functions) | **NIEZWERYFIKOWANE** — niczego nie wdrażano; produkcyjnych kont, AI, e-maili i pushy nie używano |

Testy backendu działają na bazach tymczasowych w katalogu systemowym, z pustymi kluczami z
`.env.test`; klient Anthropic to atrapa.

## 3. Ograniczenia

1. **Pierwsza treść wygrywa na stałe.** Jeśli użytkownik wkleił za pierwszym razem zły lub
   niepełny tekst, kolejne analizy go nie zmienią. Poprawka: wkleić właściwą treść w „Sprawdź
   publikacje zamawiającego" (staje się wersją i ma pierwszeństwo). Ekran o tym mówi.
2. Zapamiętywane jest tylko pole `swz` (nie wzór umowy ani przedmiar).
3. Wymagania wykrywa parser fraz — 7 typów dokumentów. Lista jest pomocą, nie kompletem; mówią to
   Radar, checklista i strona.
4. Deduplikacja szkiców pytań działa tylko dla identycznej treści; AI przy ponowieniu może ułożyć
   pytanie inaczej.
5. Aplikacja nie czyta `error.details` (klasa błędu API go nie niesie) — stan treści bierze z
   ponownego odczytu panelu.
6. Radar SWZ i przewodnik pozostają tylko po polsku (stan zastany).
7. Strona: w cenniku i opisie planu zostały „Powiadomienia push", „Faktura VAT automatycznie",
   „Pierwszeństwo we wsparciu" (płatności poza zakresem). Dostarczanie pushy na produkcji jest
   niezweryfikowane — do decyzji właściciela.
8. Domena: produkcja wskazywała kanonicznie `przetarg-ai.pl`; źródła wskazują teraz
   `przetargai.web.app`. Czy `przetarg-ai.pl` serwuje stronę — niezweryfikowane.
9. `landing/regulamin.html` i `landing/polityka-prywatnosci.html` są starsze niż produkcja i
   nie były ruszane.

## 4. Bezpieczna integracja backendu (później)

Backend jest współdzielony z CzasPracy i Fitterem. Ustalenia z samych refów gita (bez dotykania
`D:/wt/cp-railway`):

- Gałąź `codex/czaspracy-railway-20260930` odeszła od wspólnej historii 2026-09-06. Nie zmienia
  żadnego z plików tej rundy; z plików wspólnych rusza `backend/src/app.js`, którego ta runda nie dotyka.
- Żadna z gałęzi (`origin/main`, CzasPracy, `codex/przetargai-complete`, `fix/most-parametry-adresu`)
  nie ma migracji o numerze 015. Gałąź CzasPracy kończy się na 012 (nie ma 013 i 014 z `main`) —
  to trzeba rozstrzygnąć przy jej scalaniu niezależnie od tej zmiany.

Kolejność i zabezpieczenia:

1. **Kopia bazy przed wdrożeniem** (`backend/src/db/migrations/README.md`, zasada 5).
2. Scalić do gałęzi, z której wdraża się Railway. Jeśli wcześniej wejdzie inna migracja 015 —
   przenumerować tę **przed** pierwszym wdrożeniem (po zastosowaniu pliku migracji nie wolno już
   edytować: runner sprawdza sumę kontrolną).
3. Migracja stosuje się sama przy starcie (`migrate()`); jest atomowa i tworzy jedną nową tabelę.
4. Kolejność wydań: **najpierw backend, potem aplikacja.** Obie kombinacje pośrednie są bezpieczne:
   - nowy backend + aplikacja 1.1.4: nowe pola są ignorowane, a pierwsza analiza zaczyna zasilać
     checklistę (po ręcznym wskazaniu analizy, jak dotąd);
   - stary backend + nowa aplikacja: brak pól `tresc_swz` / `zrodlo_swz` → aplikacja niczego nie
     twierdzi o zapisie treści i odsyła do „Sprawdź publikacje zamawiającego"; powiązanie działa.
5. Functions nie wymagają wdrożenia.
6. Po wdrożeniu: `/health`, a potem ręczna próba na koncie testowym właściciela — utworzyć analizę,
   wkleić SWZ, sprawdzić `tresc_swz.zrodlo = "wklejona"` w panelu i wymagania w checkliście.
7. Wycofanie: poprzedni commit. Tabela może zostać (nic jej nie czyta); `DROP TABLE IF EXISTS
   swz_tresc_wklejona` tylko świadomie, bo usuwa zapisane treści.
8. Miejsce na wolumenie: jedna treść na postępowanie, do 2 mln znaków (limit trasy). Przed
   wdrożeniem warto sprawdzić zapas na wolumenie Railway.

## 5. Publikacja strony (po przeglądzie)

Na hosting kopiować **tylko**: `landing/index.html`, `landing/sitemap.xml`, `landing/robots.txt`
(`pobierz.html` jest identyczny z produkcją). Nie kopiować `regulamin.html` ani
`polityka-prywatnosci.html` — źródła w gicie są starsze. Najpierw kanał podglądu, potem
`firebase deploy --only hosting --project przetargai`; wycofanie przez poprzednie wydanie w konsoli.
Strona opisuje funkcje obecne w kodzie; krok „Sprawdź dokumenty" działa płynnie dopiero po
wdrożeniu backendu z tej rundy i nowego wydania aplikacji.
