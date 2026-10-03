# Pierwsza oferta — pierwszy mały zakres (2026-10-03)

Worktree `D:/wt/przetargai-release`, gałąź `integ/1.1.2`, baza `6ccae33`.
Stan: **zmiany w drzewie roboczym, bez commita, bez pusha, bez deployu.** Pamięć nietknięta.
Odbiorca: małe firmy składające pierwsze oferty.

## 1. Co zostało zrobione

### Aplikacja (mobile)

| Plik | Zmiana |
|---|---|
| `mobile/src/lib/sciezkaDoOferty.js` | Nowa czysta `parametryNarzedzia(ekran, match)` — parametry nawigacji z kontekstu przetargu; `null`, gdy ekran wymaga identyfikatora, a kontekst go nie ma. Nowa czysta `nastepnyKrok(wykonane)` — pierwszy nieodhaczony krok wymagany. `zbudujSciezke` zwraca dodatkowo `nastepny`. Kroki `oplacalnosc` i `dokumenty` dostały pole `dodatkowe` (wejścia do `CzyWarto` i `ChecklistaOferty`). Klucze, kolejność, treść i liczba kroków bez zmian — zapisany postęp użytkowników się nie przelicza. |
| `mobile/src/lib/radarSwz.js` | Nowa czysta `wstepneDaneRadaru(params)` — nazwa i daty z ogłoszenia w zapisie `RRRR-MM-DD` (dzień kalendarzowy w Polsce, przez `lib/dataUtc.js`); przy wątpliwości pole zostaje puste. |
| `mobile/src/screens/SciezkaDoOfertyScreen.js` | Nawigacja przez `parametryNarzedzia` (dotąd każdemu narzędziu szło tylko `{ nazwa }`). Karta „Następny krok" z jednym działaniem („Otwórz narzędzie" + „Oznacz jako zrobione"). Wejścia dodatkowe przy krokach pokazują się tylko, gdy da się je otworzyć. Komunikat „Komplet kroków odhaczony — powodzenia na otwarciu!" zastąpiony neutralnym: odhaczenia są deklaracją użytkownika, przewodnik nie sprawdza kompletności oferty. |
| `mobile/src/screens/RadarSwzScreen.js` | Ekran czyta `route.params` i wstępnie wypełnia formularz „Weź postępowanie pod radar" + informacja, że dane pochodzą z ogłoszenia i nic nie zostanie dodane bez naciśnięcia „Dodaj do radaru". Bez parametrów (katalog narzędzi) — jak dotąd. Bez zmian backendu i bez automatycznego powiązania. |
| `mobile/src/screens/MatchDetailScreen.js` | Przycisk „Co muszę mieć do dnia składania" (PL/EN przez `t()`) pod „Krok po kroku do wygranej" — bezpośrednie wejście do istniejącej `ChecklistaOferty`. |
| `mobile/test/sciezkaNawigacja.test.js` (nowy) | 20 testów: parametry dla kontekstu pełnego / niepełnego / brakującego, następny krok, spójność z nawigatorem i z parametrami czytanymi przez ekrany. |
| `mobile/test/radarSwzWstepne.test.js` (nowy) | 8 testów wstępnego wypełnienia formularza, w tym granica doby czasu polskiego i złe zapisy dat. |

API frameworka Expo nie było dotykane (czysty JS, parametry tras React Navigation, istniejące komponenty). Indeks dokumentacji Expo v54 przeczytany zgodnie z `mobile/AGENTS.md` — nie obejmuje użytych elementów.

### Strona (`landing/index.html`)

**Źródło żywej strony:** `https://przetargai.web.app/` jest bajt w bajt równe plikowi
`D:/projekty/przetarg-ai/firebase/hosting/index.html` (22 674 B, `cmp` = identyczne). To nieśledzony
artefakt deployu w starym checkoucie; `landing/index.html` w gicie był starszą wersją (bez sekcji
narzędzi, linków sklepów i licznika na żywo).

Dlatego `landing/index.html` został **oparty na żywym HTML**, a dopiero na nim naniesiono zmiany.
`git diff` pokazuje więc dwie rzeczy naraz (dogonienie live + nowe zmiany). Faktyczna delta wobec
żywej strony:

| Miejsce | Było (live) | Jest |
|---|---|---|
| canonical, `og:url`, `og:image`, `twitter:image`, JSON-LD `Organization` | `przetarg-ai.pl` | `przetargai.web.app` |
| JSON-LD oferta Standard | `49`, „netto" | `99`, „brutto" |
| 3 przyciski „Zacznij za darmo" (menu, pasek, hero) | `#cennik` | `#pobierz` |
| Hero `h1` i lead | „Nie przegap żadnego przetargu…" | pierwsza oferta: wymagania SWZ, dokumenty na dzień składania, następny krok; „nie gwarancja wygranej" |
| Drugi przycisk hero | „Zobacz, jak to działa" → `#jak-dziala` | „Zobacz ścieżkę pierwszej oferty" → `#pierwsza-oferta` |
| Statystyka środkowa | „~2 h dziennie traci firma…" | „0–100 — skala oceny dopasowania…" (cecha produktu, nie statystyka) |
| Karta „Powiadomienia i widok dzienny" | „…— nic Ci nie umknie." | usunięte |
| Nowa sekcja `#pierwsza-oferta` (między narzędziami a „Jak to działa") | — | 3 kroki: wymagania (Radar SWZ), dokumenty (checklista), następny krok (przewodnik) + zastrzeżenie + przycisk do pobrania |
| Plakietka planu Standard | „Najczęściej wybierany" | usunięta |
| Nagłówek końcowego CTA | „Zacznij wygrywać przetargi już dziś" / „…w 2 minuty" | „Pobierz PrzetargAI i przygotuj pierwszą ofertę" / bez liczby |
| `title`, `description`, `og:title`, `twitter:title` | „nie przegap żadnego przetargu", „budowlanej lub IT" | opis zgodny z nowym hero |

Bez zmian: cena 99 zł w cenniku, linki Google Play / App Store / APK, sekcja narzędzi, licznik
na żywo, FAQ (i jego odpowiednik w JSON-LD), stopka z zastrzeżeniem o niezależności, regulamin,
płatności, faktury, konfiguracja hostingu, `styles.css`.

Nowy test: `mobile/test/landingStrona.test.js` (9 testów, czyta źródło, bez sieci).

## 2. Wyniki

| Sprawdzenie | Wynik |
|---|---|
| `npm --prefix mobile test` (całość) | **PASS** — 1107 testów, 0 błędów (baza 1070 + 37 nowych) |
| `npm --prefix mobile run check` (esbuild wszystkich `src/**/*.js`) | **PASS** — exit 0, bez ostrzeżeń |
| Parametry nawigacji: kontekst pełny / niepełny / brakujący | **PASS** (`sciezkaNawigacja.test.js`) |
| Wyznaczanie następnego kroku (pusty, dziura w środku, opcjonalne, komplet) | **PASS** |
| Wstępne dane Radaru SWZ (daty, strefa PL, śmieci) | **PASS** (`radarSwzWstepne.test.js`) |
| Katalog narzędzi bez kontekstu działa jak dotąd | **PASS** na poziomie logiki (pusty formularz, `{}` dla narzędzi); ekran nieuruchamiany |
| Landing: domena, cena 99 brutto, CTA → `#pobierz`, linki sklepów, kotwice, pliki lokalne | **PASS** |
| Landing: FAQ = JSON-LD `FAQPage` | **PASS** |
| Landing: brak „~2 h", „Najczęściej wybierany", „przegapisz", obietnicy wygranej | **PASS** |
| Landing: treści żywej strony nie cofnięte | **PASS** (test + `diff` wobec live) |
| Działanie ekranów na urządzeniu / w przeglądarce | **NIEZWERYFIKOWANE** — aplikacji nie uruchamiałem |
| Wygląd strony w przeglądarce | **NIEZWERYFIKOWANE** — skrypt licznika woła produkcyjne API, więc strony nie renderowałem |
| Testy `backend/` i `firebase/functions` | **NIEURUCHAMIANE** — kod nietknięty; Functions wymagają emulatora |
| Czy `przetarg-ai.pl` serwuje stronę | **NIEZWERYFIKOWANE** |
| Która wersja aplikacji jest w sklepach | **NIEZWERYFIKOWANE** |

## 3. Ograniczenia i ryzyka

1. **Luka w backendzie zostaje** (poza zakresem z polecenia). SWZ wklejona w „Wygeneruj pytania"
   nie jest zapisywana jako wersja (`backend/src/routes/radarSwz.js:145-170`), więc checklista
   pozna wymagania dopiero po wklejeniu treści w „Sprawdź publikacje zamawiającego" i ręcznym
   wskazaniu analizy w checkliście. Podpowiedź w `RadarSwzScreen.js` („Wklej treść SWZ w
   »Wygeneruj pytania«…") nadal wprowadza w błąd. Sekcja strony opisuje mechanizm prawdziwie,
   ale droga początkującego będzie gładka dopiero po tej poprawce — rekomenduję ją jako następny krok.
2. **Brak automatycznego powiązania** Radar SWZ ↔ przetarg (z polecenia). Formularz jest wypełniony,
   ale analizę trzeba nadal wybrać ręcznie w checkliście.
3. **Domena.** Żywa strona wskazywała kanonicznie `przetarg-ai.pl`; zmieniłem na potwierdzone
   `przetargai.web.app`. `sitemap.xml` i `robots.txt` na hostingu nadal mówią `przetarg-ai.pl` —
   po publikacji będzie niespójność. Nie ruszałem ich (zakres: `index.html`). Do decyzji: jedna domena wszędzie.
4. **Reszta `landing/` jest starsza niż live.** `pobierz.html` (w gicie: 1.0.8, „iPhone wkrótce";
   live: Google Play + App Store), `regulamin.html`, `polityka-prywatnosci.html`, `sitemap.xml`,
   `robots.txt` różnią się od hostingu. **Nie kopiować całego `landing/` na hosting.**
5. **Twierdzenia pozostawione celowo** (płatności/faktury/regulamin poza zakresem albo nie zlecone):
   „Faktura VAT automatycznie" (cennik, FAQ), „Pierwszeństwo we wsparciu", push jako wyróżnik
   Standard, wartość zastępcza „300+" licznika, „dla firm budowlanych i IT" w stopce i w opisie
   organizacji, FAQ o źródłach wymieniające tylko BZP.
6. **Strona a wersja aplikacji.** Tekst strony opisuje funkcje istniejące już w kodzie 1.1.4
   (Radar SWZ, checklista z „Następnym krokiem", przewodnik). Nowa karta „Następny krok" w
   przewodniku i przycisk checklisty w szczegółach wymagają nowego wydania aplikacji.
7. Ekrany ścieżki i Radaru SWZ pozostają wyłącznie po polsku (stan zastany).
8. Szkice `landing/v2`, `landing/v3` nadal mają 49 zł w JSON-LD (nietknięte).

## 4. Bezpieczne kroki publikacji

### Strona
1. Przejrzeć deltę wobec live (tabela wyżej; `diff <hosting>/index.html landing/index.html`).
2. Otworzyć `landing/index.html` lokalnie i obejrzeć nową sekcję oraz cennik bez plakietki
   (desktop + telefon).
3. Zrobić kopię obecnego `firebase/hosting/index.html`, potem skopiować **tylko**
   `landing/index.html` do katalogu hostingu, z którego idzie deploy.
4. Najpierw kanał podglądu: `firebase hosting:channel:deploy pierwsza-oferta --project przetargai`,
   sprawdzić adres podglądu.
5. `firebase deploy --only hosting --project przetargai`.
6. Po wdrożeniu: HTTP 200, `canonical`, cena 99 w JSON-LD, przycisk „Zacznij za darmo" przewija
   do pobierania, linki sklepów działają.
7. Wycofanie: poprzednie wydanie w konsoli Firebase Hosting albo kopia z kroku 3 i ponowny deploy.

### Aplikacja
1. Commit na gałęzi roboczej i przegląd.
2. Ręczny test na urządzeniu: szczegóły → „Co muszę mieć do dnia składania"; szczegóły →
   „Krok po kroku" → karta „Następny krok" → Radar SWZ z wypełnionym formularzem; Radar SWZ
   z „Wszystkich narzędzi" (pusty formularz); krok „Dokumenty" → checklista; krok „Decyzja" → „Czy warto".
3. Podbić wersję (`mobile/app.json` i `mobile/android/app/build.gradle`), zbudować wg przepisu
   wydania. Backend i Functions bez zmian — deploy niepotrzebny.

## 5. Następny krok (rekomendacja)

Poprawka backendu: `/analiza` zapisuje wklejoną SWZ jako wersję bazową, gdy postępowanie nie ma
jeszcze żadnej wersji (pierwsza wersja nie tworzy wpisu zmiany ani nie woła AI). Razem z
automatycznym powiązaniem analizy z przetargiem zamyka drogę przetarg → SWZ → checklista.
