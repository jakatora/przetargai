# PrzetargAI — system wizualny (2026-10)

Wspólny kierunek dla strony `landing/` i aplikacji `mobile/` (Expo RN: Android, iOS, web, Windows).
Źródło decyzji: skill `ui-ux-pro-max` (`--design-system`, zapytanie „B2B SaaS AI assistant public
tender procurement automation…”, pokrętła: variance 5, motion 3, density 5) oraz zasady skilla
`frontend-design`. Ten plik jest punktem odniesienia przy każdej zmianie wyglądu.

## Co design ma mówić

Jedno zdanie: **aplikacja szuka przetargów i robi za Ciebie większość pracy**. Użytkownik to
właściciel małej lub średniej firmy (budowlanka, usługi, dostawy), który nie ma czasu czytać BZP.
Interfejs ma pokazywać pracę wykonaną przez aplikację (raport przeglądu, wybrane na dziś,
odrzucone z przyczyną, wymagania wypisane z SWZ), a nie zestaw funkcji do samodzielnej obsługi.

- Wzorzec ze skilla: **Trust & Authority + Conversion**, styl **Enterprise SaaS**.
- Anty-wzorce ze skilla: fioletowo-różowe gradienty „AI”, zabawny ton, ukryty cennik, emoji jako ikony.
- Treść: tylko istniejące funkcje, bez obietnicy wygranej, bez liczb „z powietrza”
  (pilnuje `mobile/test/landingStrona.test.js`).

## Wyróżnik: zakreślacz

Jedyny „głośny” element marki to **żółty zakreślacz** (`#fde68a`) na fragmentach, które aplikacja
wyciągnęła z dokumentów: w hero strony (kartka SWZ z zakreślonymi warunkami, jedyna animacja na
stronie, wyłączana przez `prefers-reduced-motion`) i w aplikacji (dokumenty wypisane przez AI w
„Wyjaśnieniu AI” na ekranie przetargu). Nie używamy go jako ogólnego akcentu, tła sekcji ani
koloru przycisków. Wszystko wokół jest spokojne: granat, biel, jeden niebieski.

## Paleta

Tokeny aplikacji: `mobile/src/lib/motyw.js` (`PALETY.jasny` / `PALETY.ciemny`, parytet kluczy i
kontrast pilnuje `mobile/test/motyw.test.js`). Strona: zmienne CSS w `landing/styles.css` (te same
wartości, ciemny motyw przez `prefers-color-scheme`).

| Rola | Token aplikacji | Jasny | Ciemny |
|---|---|---|---|
| Tło ekranu („papier”) | `bg` | `#f3f6fa` | `#0b1322` |
| Karta, nagłówek | `surface` | `#ffffff` | `#131d31` |
| Wnętrze, wciśnięty wiersz | `powierzchniaWtorna` | `#f7f9fc` | `#18233a` |
| Tekst (atrament) | `text` | `#0f1b2d` | `#e6ecf6` |
| Tekst drugoplanowy | `textMuted` | `#526075` | `#9aa8bf` |
| Linie, obramowanie kart | `border` | `#dde3ec` | `#263250` |
| Obramowanie kontrolek (≥3:1) | `obramowaniePola` | `#848fa2` | `#5a6a8e` |
| Akcent (zgodny z ikoną) | `blue` | `#1d4ed8` | `#7aa2ff` |
| Tekst na akcencie | `naAkcencie` | `#ffffff` | `#0b1630` |
| Delikatne tło akcentu | `wyroznienie` | `#e8effd` | `#1a2847` |
| Ciemny blok | `atrament` / `naAtramencie` / `atramentDrugi` | `#0f1b2d` / `#fff` / `#b8c4d8` | `#1c2a47` / `#fff` / `#b8c4d8` |
| Zakreślacz | `zakreslacz` | `#fde68a` | `#4a3c0e` |
| Sukces | `sukcesAkcent` na `sukcesTlo` | `#15803d` / `#dcfce7` | `#4ade80` / `#11372a` |
| Ostrzeżenie | `ostrzezenieTekst` na `ostrzezenieTlo` | `#92400e` / `#fef3c7` | `#fcd34d` / `#3a2e10` |
| Błąd | `danger` na `dangerTlo` | `#b91c1c` / `#fee2e2` | `#f87171` / `#3b1518` |
| Cień uniesienia | `cien` | `rgba(15,27,45,.08)` | `rgba(0,0,0,.45)` |

Zasady:
- Token `white` zastąpiło **`naAkcencie`**: w ciemnym motywie akcent jest jasny, więc tekst na nim jest
  ciemny (biały na `#7aa2ff` miał 3,3:1). Na wypełnionym akcencie zawsze `naAkcencie`, nigdy surowy `#fff`.
- Surowe hexy w ekranach są zakazane (wyjątek: `GranicaBledu`, która działa poza dostawcą motywu).
- Kolor nie jest jedynym nośnikiem znaczenia: termin „pilny”/„po terminie” i wynik dopasowania mają też tekst.

## Typografia

- **Strona:** Plus Jakarta Sans (OFL), hostowana lokalnie w `landing/fonts/` — dwa pliki zmiennej
  grubości (łacina + łacina rozszerzona z polskimi znakami, razem ok. 49 KB), `font-display: swap`,
  bez zapytań do Google. Nagłówki 800 z ciasnym światłem, tekst 17 px / 1,6.
- **Aplikacja:** font systemowy (San Francisco / Roboto / Segoe UI). Powód: natywny wygląd, skalowanie
  Dynamic Type i brak nowej paczki fontów w aplikacji (bez zmian natywnych). Skala w
  `mobile/src/theme.js` → `typografia`:

| Styl | Rozmiar / interlinia / grubość | Użycie |
|---|---|---|
| `ekran` | 26 / 32 / 800 | powitanie, logowanie |
| `tytul` | 20 / 26 / 800 | tytuł przetargu, karta firmy |
| `sekcja` | 17 / 22 / 700 | nagłówki sekcji, dni na liście |
| `karta` | 16 / 21 / 700 | tytuł na karcie listy |
| `tresc` | 15 / 22 | tekst |
| `drobny` | 13 / 18 | opisy, metadane |
| `etykieta` | 12 / 16 / 700 | etykiety grup filtrów |

Bez wersalików w etykietach i bez strzałek „→” dopisywanych do przycisków.

## Geometria

- Odstępy: `spacing` = 4 / 8 / 16 / 24 / 32 / 48.
- Promienie z hierarchią: chip i plakietka 8, przycisk i pole 12, karta 16, blok powitalny 20.
- Cień tylko dla elementów „ważniejszych” (`uniesienie(k)` w `theme.js`: wybrany segment
  przełącznika, arkusze). Karty listy mają samo obramowanie.
- Dotyk: minimum 44 pt (`DOTYK`), przyciski 50 pt, chipy filtrów 36 pt z odstępem 8.
- Szerokie okno (web, Windows, tablet): treść w kolumnie do 760 px (`Screen`, listy).

## Komponenty aplikacji

| Komponent | Plik | Rola |
|---|---|---|
| Przycisk | `components/Button.js` | `primary` (akcent), `ghost` (obramowanie, tekst w akcencie), `danger`; wciśnięcie: przygaszenie + skala 0,98 |
| Pole | `components/TextField.js` | etykieta nad polem, obramowanie `obramowaniePola`, widoczny fokus (niebieska ramka 2 pt), błąd pod polem |
| Karta przetargu | `components/MatchCard.js` | wynik (tonowane tło + liczba), tytuł, zamawiający; pasek: termin + status + wadium |
| Wiersz akcji | `components/WierszAkcji.js` | listy narzędzi i ustawień w jednej karcie zamiast kolumn przycisków |
| Ikony | `components/Ikona.js` | szukaj, zamknij, dalej, ok, uwaga, filtr, dokument — rysowane z widoków, barwione tokenami |
| Stany | `components/Stan.js` | `StanLadowania` (szkielet kart), `StanPusty` (co się stało + jedna akcja), `StanBledu` (co nie wyszło + „Spróbuj ponownie”) |

Wzorce ekranów:
- **Nagłówek** na `surface` z tytułem w kolorze tekstu i niebieskim powrotem (oba motywy).
- **Przełącznik trybu** („Dla mnie / Wszystkie”, język, wygląd): kontrolka segmentowa — jeden tor
  `neutralneTlo`, wybrany segment na `surface` z cieniem.
- **Filtry** schowane pod przyciskiem „Filtry” z licznikiem aktywnych; lista jest ważniejsza niż panel.
- **Raport pracownika** (góra listy przetargów) i **powitanie** na `atrament` — miejsca, w których
  aplikacja mówi, co zrobiła sama.

## Strona

- Układ: hero (obietnica + scena SWZ z zakreślaczem), pasek faktów (licznik „na żywo” tylko po
  udanym pobraniu), „Pracuje za Ciebie” (4 etapy pracy aplikacji — to sekwencja, stąd numery w kolejności),
  „Pierwsza oferta”, narzędzia, jak zacząć, cennik (dwa plany w jednym kontenerze, Standard na
  ciemnym paśmie), FAQ, CTA ze sklepami i APK, stopka z zastrzeżeniem niezależności (wymóg Google Play).
- Mobile: bez poziomego przewijania przy 375 px, hamburger z `aria-expanded`, Escape i klikiem poza.
- Dostępność: link „Przejdź do treści”, widoczny fokus (3 px), kontrast AA w obu motywach,
  `prefers-reduced-motion`, przyciski ≥44 px.
- Powiadomienia push: wolno o nich pisać tylko w cenniku (test). Działają na Androidzie; na iPhonie
  jeszcze nie — strona tego nie obiecuje.
- Strony prawne korzystają z tego samego arkusza; ich treści nie zmieniamy (dane firmy).
