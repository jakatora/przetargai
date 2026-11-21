# Backlog: praca zespołowa (szef i pracownik) — ocena 2026-11-10

Punkt 7 z przeglądu „oczami pracownika” (10.11). Oceniony jako **backlog, nie budowany** w audycie 10–11.11 —
to nowy moduł z modelem danych, uprawnieniami i ścieżką pieniędzy (miejsca w planie), więc wymaga osobnego
etapu z projektem i testami izolacji.

## Problem (z przeglądu i danych)

- Małą firmą budowlaną przetargi „ogarnia” zwykle jedna osoba z biura, a decyzję „startujemy?” podejmuje szef.
  Dziś: jedno konto = jedna osoba. Pracownik przekazuje przetarg szefowi linkiem przez „Udostępnij”
  (tekst z tytułem, terminem i adresem), szef nie widzi uzasadnienia, analizy SWZ ani terminów.
- Produkcja 7–10.11: 11 z 27 kont aktywnych, 0 decyzji w apce przed 1.2.2 — najpierw trzeba, żeby decyzje
  w ogóle padały (1.2.2 + poprawki przeglądu), dopiero potem dzielić je między osoby.

## Stan kodu (co blokuje „po prostu dodać”)

- Wszystkie dane robocze żyją per konto: `users/{uid}/matches`, `saved` (etap, notatka, przypomnienia 7/3/1),
  `alerty`, `powiazania_swz`, `auto_swz`, `limity`; karta firmy (`karta`, NIP) na dokumencie użytkownika.
- Plan i próba (`premium_tier`, `proba_do`, `stripe_*`) są na koncie; webhook Stripe aktywuje jedno konto.
- Selekcja AI (pracownik co 3 h) liczy dopasowania per konto — dwa konta tej samej firmy = podwójny koszt AI.
- Reguły Firestore: klient nie ma dostępu (`if false`), całość przez API → izolacja w kodzie tras i testach.

## Jak to robią inni (źródła: `G:/Projekty/audyt-czaspracy-przetarg-20261110/claude-przetarg-konkurencja.md`, sekcja 4)

- PL: pełny obieg (tablica, przypisania, role) tylko Tender Vision w Premium 2 999 zł netto/mies.;
  Och! Przetargi — tylko więcej adresów alertów. Tanio = wolna nisza.
- Świat: przypisanie + komentarz standardem nawet tanio (Stotles Free, Tendium bez limitu użytkowników);
  płaci się za uprawnienia/SSO.

## Propozycja etapami (od najtańszego, każdy etap osobno użyteczny)

| Etap | Zakres | Pracochłonność | Ryzyko |
|---|---|---|---|
| **0. „Wyślij szefowi do decyzji”** (bez zespołu) | Z karty przetargu: link jednorazowy (jak `/maile/ocena`, token 14 dni) na stronę WWW z uzasadnieniem, terminem, warunkami i przyciskami „Startujemy / Nie”. Decyzja szefa wraca do konta pracownika (etap + powiadomienie). | **S** | niskie: istniejący wzorzec linków z maili; bez zmian modelu danych |
| **1. Druga osoba w koncie firmy** | Kolekcja `firmy/{id}` z członkami (rola `szef`/`pracownik`), zaproszenie mailem; `saved` przeniesione na firmę (`firmy/{id}/saved`) z polem `kto` (przypisany) i `decyzja_szefa`; przypomnienia 7/3/1 do przypisanej osoby. Dopasowania dalej liczone RAZ na firmę. | **M/L** | migracja danych `saved` (wsteczna zgodność tras), testy izolacji firm, push/e-mail per osoba |
| **2. Miejsca w planie** | 2–3 osoby w Standard, dopłata za kolejne (Stripe quantity) | **M** | ścieżka pieniędzy: proracja, obniżenie liczby miejsc, webhook — przegląd `money-path-review` |

## Rekomendacja

Najpierw **etap 0**. Rozwiązuje główny ból z przeglądu, czyli „szef nie dostaje do decyzji”, bez nowego
modelu danych, w czasie 1–2 dni z testami. Etap 1 rozważyć dopiero, gdy będzie dowód popytu: liczba użyć
„Wyślij szefowi” i pytania klientów o drugie konto. Etap 2 dopiero po etapie 1.

Otwarte pytania do właściciela: czy etap 1 ma być w cenie Standard 99 zł, czy w osobnym planie „Firma”?
Czy szef ma mieć własne konto, czy wystarczy mu link?
