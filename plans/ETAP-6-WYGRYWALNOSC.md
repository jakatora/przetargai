# Etap 6 — wygrywalność i przygotowanie oferty oparte na danych

Cel: przejść od „co jest ogłoszone" do „czy w tym w ogóle wygrasz i co masz zrobić,
żeby złożyć ofertę na czas". Bez płatnego AI, bez obiecywania prawdopodobieństwa
wygranej, bez scrapingu portali, które tego zabraniają.

Produkcja to Cloud Functions v2 (`firebase/functions`) — tam idzie cały kod backendu.
Katalog `backend/` (Railway) zostaje nietknięty.

## Sonda żywych API wykonana PRZED pisaniem kodu (2026-09-24)

Bez niej trzy z czterech założeń etapu byłyby błędne.

### BZP — `NoticeType`

Dozwolone typy sprawdzone brute-force (API odrzuca nieznane 400, bez listy
dozwolonych; swagger 404). Działają: `ContractNotice`, `TenderResultNotice`,
`ConcessionNotice`. **Nie istnieją**: `ContractAwardNotice`, `CancellationNotice`,
`ContractModificationNotice` i 15 innych sprawdzonych wariantów.

> **Wniosek:** „wynik / udzielenie / unieważnienie" w BZP to **jeden** typ ogłoszenia
> (`TenderResultNotice`), a nie trzy. Rozróżnia je pole `procedureResult`.
> Doprowadzenie źródła do kompletności to NIE dodanie typów, tylko przestanie gubić
> to, co ten jeden typ już niesie.

### BZP — pola, których parser R16 w ogóle nie czytał

Próbka 200 ogłoszeń z 2026-09-22 (żywe API):

| Fakt | Pomiar |
|---|---|
| `procedureResult` = `zawarcieUmowy;…;uniewaznienie;…` — **jeden wpis na część** | 545 części w 200 ogłoszeniach |
| `contractors[]` — nazwa, NIP, miasto, województwo zwycięzcy, **równolegle do części** | 395 znanych zwycięzców |
| unieważnienia | **150 z 545 części (27,5 %)** — dziś niewidoczne w statystykach |
| `4.5.5.) Wartość części` (szacowana, per część) | 405 wystąpień |
| `4.3.) Wartość zamówienia` (szacowana, per ogłoszenie) | 75 ogłoszeń |

### BZP — dwa zmierzone błędy obecnego parsera

1. **Kwoty bez groszy giną.** `KWOTA` wymaga przecinka (`/(\d[\d\s ]*,\d{1,2})\s*PLN/`),
   a BZP zapisuje `6.4.) … 9840 PLN`. Na próbce: **39 z 404 cen wybranych (9,6 %)**
   jest bez groszy → dziś wypadają ze statystyki cen bez śladu.
2. **Podział na części.** `split(/SEKCJA V(?!I)/)` daje przy ogłoszeniu
   wieloczęściowym blok-widmo (nagłówek sekcji przed pierwszą częścią), więc
   `numer` części jest przesunięty o 1. Warianty podziału sprawdzone na próbce
   względem `procedureResult` (jedyne wiarygodne źródło liczby części):

   | reguła | zgodnych ogłoszeń |
   |---|---|
   | blok zawiera `SEKCJA VI` | 170 / 200 (gubi części unieważnione — te nie mają sekcji ofert) |
   | liczba nagłówków `SEKCJA V ZAKO…` | 164 / 200 |
   | **blok zawiera `5.1.)`** | **200 / 200** |

   Kolejność też się zgadza: znacznik unieważnienia w HTML pasuje do
   `procedureResult[i]` w **545 / 545** części; `contractorName === null` przy
   unieważnieniu w **150 / 150**. `contractors.length === procedureResult.length`
   w 198 / 200 ogłoszeń → pozostałe 2 wymagają obrony (nie przypisujemy zwycięzcy
   na chybił trafił).

### BZP — pułapka „rabatu": 4.3 jest NETTO, 6.4 zwykle BRUTTO

Wartość zamówienia (art. 28 Pzp) jest z definicji **bez VAT**, a cena oferty w
formularzu jest podawana zwykle **brutto**. Pomiar na 46 jednoczęściowych
ogłoszeniach z umową:

- mediana `cena wybrana / wartość szacowana` = **1,0489**,
- **29 z 46** wypada „powyżej kosztorysu",
- widoczne skupiska dokładnie na **1,23** (VAT 23 %) i **1,17**.

> **Wniosek:** licząc „rabat" wprost z 4.3 vs 6.4 pokazalibyśmy firmie, że w jej
> branży przetargi idą DROŻEJ niż kosztorys — czyli dokładnie odwrotnie niż jest.
> Stawki VAT (23/8/5/0 %) nie da się odgadnąć z ogłoszenia. Dlatego:
> **rabat względem wartości szacowanej liczymy wyłącznie tam, gdzie obie liczby są
> w tej samej bazie (TED, eForms — obie netto).** Dla BZP oddajemy zamiast tego
> rabat W OBRĘBIE konkursu ofert (6.2/6.3/6.4 — wszystkie w tej samej bazie), co
> jest porównywalne i sprawdzalne.

### TED — `form-type`

Sprawdzone na żywo: `result` → `can-standard` (996 polskich ogłoszeń w 6 dni),
`cont-modif` → `can-modif`. `chan` nie istnieje. Pola wyniku potwierdzone:
`winner-name`, `winner-size`, `winner-decision-date`, `tender-value`,
`tender-value-lowest/-highest`, `estimated-value-lot`, `result-value-notice`,
`received-submissions-type-code`/`-val`, `non-award-justification`,
`contract-conclusion-date`, `result-lot-identifier`, `buyer-country-sub`.

Pułapki zmierzone na żywo:

1. **Tablice pól NIE są wyrównane między sobą.** Ogłoszenie 659988-2026:
   `result-lot-identifier` = 14, `winner-name` = 14, ale `winner-size` = 7.
   Zipowanie po indeksie między różnymi polami przypisze firmie cudzy rozmiar.
   → Zipujemy TYLKO pola o długości równej liczbie części; reszta idzie jako
   dane na poziomie ogłoszenia albo wcale.
2. **`received-submissions-type-code` ma zmienną kolejność kodów** między
   ogłoszeniami (`tenders,t-esubm,…` vs `t-esubm,t-oth-eea,…`). Wolno je czytać
   wyłącznie parami `code[i]` ↔ `val[i]`, nigdy po pozycji.
3. **`buyer-country-sub` to NUTS, nie TERYT** (`PL426`, `PL22A`, `PL911`).
   Istniejące `kodWojewodztwa('PL426')` bierze ostatnie dwie cyfry → „26"
   (świętokrzyskie) zamiast zachodniopomorskiego (32). Potrzebna osobna mapa
   NUTS2 → TERYT.
4. **`non-award-justification`** (`no-rece` = nie złożono ofert) to znacznik
   unieważnienia po stronie TED.

## Zakres etapu

1. **Kompletne źródło rozstrzygnięć** — normalizacja BZP (udzielenie +
   unieważnienie + zwycięzca + wartość szacowana) i TED (`result` + `cont-modif`),
   powiązanie z ogłoszeniem, dedup, okno z checkpointem, ponowienia, metryki
   w `/health`.
2. **Benchmark** per zamawiający i per dział CPV — z liczbą obserwacji, zakresem
   dat, jawnym „brak danych" i minimalną próbką przed wnioskiem.
3. **Karta „Czy warto startować?"** — zielone/żółte/czerwone czynniki, nigdy
   procent szans.
4. **Checklista przygotowania oferty** — spięta z zapisanym przetargiem, Radarem
   SWZ, Sejfem i kalendarzem; działa przy chwilowej niedostępności backendu.
5. **Mobile** — benchmark, „Czy warto", checklista z następnym krokiem, PL/EN,
   stany brak danych / ładowanie / błąd / ponów, dostępność.
6. **Testy, małe commity, wdrożenie, dowody live, aktualizacja statusu.**
