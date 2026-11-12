# Dziesięć rund: analiza → ulepszenie → sprawdzenie (2026-11-12)

Polecenie właściciela: „przeanalizuj aplikację PrzetargAI i zastanów się, jak ją udoskonalić, poprawić albo
rozwinąć graficznie, UI, funkcyjnie — i tak 10×”. Każda runda poniżej to osobna analiza (co widać w apce
i w kodzie, dlaczego to przeszkadza leniwemu wykonawcy), jedno ulepszenie i dowód. Źródła analizy: wersja web
aplikacji 1.2.10 na danych przykładowych (375×812, jasny i ciemny motyw), kod `mobile/` i `firebase/functions/`,
przegląd „oczami pracownika” z 10.11, audyt z 10–11.11, projekt UI z 7.11 i raport konkurencji z 10.11.

| # | Rodzaj | Analiza — co było nie tak | Ulepszenie | Sprawdzenie | Commit |
|---|---|---|---|---|---|
| 1 | funkcja | Alert o zmianie zapisanego przetargu wymieniał tylko nazwy pozycji („5.4. Warunki udziału”). Żeby wiedzieć, CO się zmieniło, trzeba było otworzyć BZP — a ogłoszenie o zmianie ma obie wartości w treści. Konkurencja (przetarguj.pl) pokazuje „przed → po”. | Parser `zmianyPrzedPo` + `opisZmiany`: „6.4. Wadium: było „20 000 zł”, jest „35 000 zł””, także „dodano”/„usunięto”. Treść alertu, pusha i maila; pole `zmiany` w alercie. | Test na prawdziwym ogłoszeniu BZP z fixture (13/13), przegląd parsera na wszystkich ogłoszeniach z fixture. | `84b72dc` |
| 2 | UI | Panel dnia to lista kart bez początku i końca: nie widać, ile decyzji zostało ani że na dziś wszystko zrobione. Po „Biorę” karta zostawała wśród niezdecydowanych. Projekt UI zakładał „Decyzja X z N” i stan „Gotowe”. | Pasek „Do decyzji: X z N”, czekające na górze, po ostatniej decyzji karta „Na dziś gotowe” z liczbą wziętych, następnym przeglądem i przejściem do ofert. | `lib/postepDnia.js` z testem (odmiana PL), zrzuty: postęp → 1 wzięty → gotowe. | `f95c686` |
| 3 | grafika | „Moje postępowania” pokazywały etap samą kropką i liczbą; nie było widać proporcji ani gdzie na ścieżce jest dana oferta. Nagłówek „4 postępowań” (błąd odmiany). Brak odświeżania. | „Moje oferty”: lejek etapów (pasek proporcji + legenda), skuteczność „Wygrane: X z Y”, ścieżka 4 kroków na karcie, pociągnij-by-odświeżyć, poprawna odmiana. | Test `pulpit` (lejek, skuteczność, krok), zrzuty jasny/ciemny. | `007a238` |
| 4 | UI | W Zapisanych, żeby wiedzieć „co mam najbliżej”, trzeba było przeczytać wszystkie karty; lista odświeżała się tylko przy wejściu na ekran. | Zdanie nad listą „4 przetargi w grze · najbliższy termin za 8 dni” (ostrzegawczo przy ≤ 3 dniach) + pociągnij-by-odświeżyć. | Test `kolejnoscZapisanych` (dziś/jutro/za N dni, historia się nie liczy), zrzut. | `e8c7d7f` |
| 5 | funkcja | Punkt 7 przeglądu: w małej firmie przetargi „ogarnia” jedna osoba, a decyduje szef bez aplikacji. Jedyną drogą było „Udostępnij” z gołym tytułem i linkiem do rejestru — szef nie widział powodów wyboru i nie miał jak odpowiedzieć. Pełny moduł zespołowy oceniony jako za duży (backlog), etap 0 jako mały. | „Wyślij szefowi do decyzji”: link (7 dni, przypięty do jednego dopasowania) → strona bez logowania z przetargiem, terminem, wartością, powodami i przyciskami Startujemy / Nie startujemy; odpowiedź wraca alertem i pushem, „Startujemy” zapisuje przetarg z przypomnieniami i etapem. | `decyzjaSzefa.test.js`: cała ścieżka + granice (token dla A nie otwiera B, cudze 404, GET niczego nie zmienia, esc() danych z rejestru). | `ce7b29f` |
| 6 | grafika | Po rundzie 1 zmiany były w zdaniu — długi akapit, w którym trudno znaleźć wartości. | Karta alertu rysuje pary: pozycja, przekreślone „Było”, wyróżnione „Jest” (albo „Usunięto”). | Test `opisAlertu` (odsiewa niepełne wpisy), zrzuty jasny/ciemny. | `867db0f` |
| 7 | grafika | Konto ma wiersz „Otwórz kartę firmy”, ale nie widać, NA CZYM aplikacja opiera wybór — użytkownik nie wie, że np. nie ma ustawionego terenu, dopóki nie przejdzie 5 kroków kreatora. Projekt UI miał ekran „Firma”. | Karta „Firma w skrócie”: co robisz, czego nie bierzesz, teren (nazwy województw), kwoty; pasek wypełnienia; brak = „Uzupełnij →” prowadzące do właściwego kroku. | Test `skrotKarty`, zrzuty pełnej i pustej karty. | `7803403` |
| 8 | grafika | Nowe elementy (rundy 2–7) nie były oglądane w ciemnym motywie; w Zapisanych tytuł ucinany po 2 liniach przy plakietce dopasowania, przycisk „Pulpit” po zmianie nazwy ekranu. | Przegląd 6 ekranów w ciemnym motywie — kolory z motywu, bez poprawek; tytuł do 3 linii, znacznik zmian do 2, spójna nazwa przycisku. | Zrzuty ciemnego motywu (panel, gotowe, alerty, Zapisane, oferty, konto). | `4b4a9c9` |
| 9 | UI | Panel dnia, Zapisane, oferty i alerty podczas wczytywania pokazywały samo kółko na pustym ekranie; lista dopasowań miała już szkielet kart — niespójność i skok układu. | Wszystkie cztery miejsca używają `StanLadowania` (szkielet kart). | `npm run check`, pełne testy apki, przejście ekranów po zmianie. | `8527464` |
| 10 | funkcja | Analiza ekranu startowego po rundach 1–9: użytkownik widzi wybór dnia, ale to, co naprawdę pali się dziś (zapisany przetarg z terminem za 2 dni, alert o zmianie SWZ), jest schowane w Zapisanych i pod dzwonkiem. Projekt UI miał blok „pilna rzecz” nad decyzjami. | Pasek „Pilne dziś”: do 3 zapisanych przetargów w grze z terminem w ciągu 3 dni (najbliższy pierwszy) + „N nowych alertów”; znika, gdy nic pilnego. | Test `pilneDzis` (tylko oferty w grze, kolejność, odmiana), zrzut ekranu głównego i przejścia do alertów. | `0917a65` |

## Co analiza odrzuciła albo odłożyła
- „Ryzyko z SWZ → gotowe pytanie do zamawiającego” — sprawdzone w kodzie: Radar SWZ już generuje pytania i wniosek o wyjaśnienie w jednym kroku; nie ma czego dodawać.
- Ciche cofanie zapisów (gwiazdka, etap, przypomnienie) — Codex naprawił to 11.11 (`a4df09b`, `e77916b`); pominięte, żeby nie dublować.
- Wycena z przedmiaru i pełne zakładki na dole — za duże na rundę; zostają w backlogu (raport konkurencji, `docs/backlog-praca-zespolowa.md`).

## Przegląd po dziesięciu rundach (analiza przed poprawką)
Po zamknięciu rund przejrzałem całą gałąź pod kątem błędów, zanim cokolwiek zmieniłem. Znalezisko: gdy użytkownik
odrzuci WSZYSTKIE dzisiejsze przetargi, lista robi się pusta, a raport dalej mówi o N wybranych — panel pokazywał
jednocześnie kartę „Na dziś gotowe” i zdanie „Dziś nic nie pasuje do Twojej firmy” (nieprawdziwe: pasowało, tylko
zostało odrzucone). Poprawka: zdanie pokazuje się tylko, gdy selekcja naprawdę nic nie wybrała; test w `postepDnia`.
Uwaga o kolejności: analiza każdej rundy odbywała się przed zmianą (czytanie kodu, zrzuty ekranu), ale tabela wyżej
została spisana po zakończeniu rund, nie w ich trakcie.

## Wynik
PR `jakatora/przetargai#201`. Testy: functions 1874/1874, mobile 1438/1438, `npm run check` OK. Nic nie jest wdrożone;
rundy 1 i 5 (serwer) działają po wdrożeniu Functions, pozostałe po nowym buildzie aplikacji.

## Seria 2 — dziesięć rund w kolejności „najpierw zapisana analiza, potem zmiana”

W serii 1 analiza poprzedzała zmiany, ale została spisana po fakcie. W serii 2 każda runda zaczynała się od
sprawdzenia w kodzie (polecenie i wynik w przebiegu pracy) i zapisanego wniosku; dopiero potem była zmiana.

| # | Co sprawdziłem (analiza) | Wniosek | Zmiana | Commit |
|---|---|---|---|---|
| 1 | Gdzie `MatchDetailScreen` używa `decyzja_szefa` | Tylko w karcie na dole ekranu (ok. 7 ekranów niżej) | Plakietka „Szef: startujemy / nie startujemy” pod tytułem | `b5d977b` |
| 2 | Co karta panelu dnia pokazuje przy terminie; co zwraca `opisTerminu` | Sama data; gotowe „Zostało N dni” i flaga pilności nieużywane | „Termin ofert: … · Zostało 12 dni”, pilne w kolorze ostrzeżenia | `eb02691` |
| 3 | `AKCJE_ETAPU` w „Moich ofertach” | Następny krok tylko po złożeniu; „Rozważam” i „Przygotowuję” bez podpowiedzi | Rozważam → „Startować czy odpuścić?”, Przygotowuję → „Co musisz mieć do dnia składania” | `e07925b` |
| 4 | Jakie pola pokazuje strona decyzji; jakie są na dopasowaniu | Brak dni do terminu i wadium, choć `tender_wadium_*` są dostępne | Wiersze „Zostało” i „Wadium”; wartość i wadium w wiadomości | `d9db8fd` |
| 5 | Wiersze `skrotKartyFirmy` a kroki karty; `formalnePuste` w trasie warunków | Skrót miał 4 z 5 kroków; bez kroku 5 serwer nie porównuje warunków udziału | Piąty wiersz „Warunki udziału” | `7e5084a` |
| 6 | Przyciski karty „Na dziś gotowe” | Przy zerze wziętych — ślepy zaułek | „Popraw kartę firmy” | `4639b3a` |
| 7 | Podsumowanie „Moich ofert” przy braku pilnych | „Nic pilnego na dziś” bez terminu, niespójne z Zapisanymi | „Nic pilnego · najbliższy termin za N dni” | `487f6d6` |
| 8 | Tekst pustego centrum alertów i opis przy „Wyślij szefowi” | Nie mówiły, gdzie przyjdzie odpowiedź szefa | Oba teksty wskazują centrum alertów | `755db33` |
| 9 | Formularz strony decyzji; komentarz przy odrzuceniu w apce | Szef nie mógł dopisać warunku do decyzji | Notatka do 140 znaków → alert i karta w apce | `1cd47f1` |
| 10 | Znaczniki na `MatchCard` i w panelu dnia | Decyzji szefa nie widać na liście | Znacznik na karcie listy i w panelu dnia | `b10cec0` |

Wpadka w rundzie 8: angielski tekst z apostrofem zepsuł składnię pliku, a commit powstał mimo czerwonych testów
(łańcuch poleceń bez warunku). Naprawione przed wypchnięciem (commit poprawiony); od rundy 9 commit jest warunkowany
zielonymi testami.

Testy po serii 2: mobile 1438/1438, `decyzjaSzefa` 4/4; pełny zestaw functions — wynik w opisie PR.
