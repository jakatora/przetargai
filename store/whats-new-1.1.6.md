# PrzetargAI — teksty wydania 1.1.6 (App Store + Google Play)

Wersja: **1.1.6** · Android `versionCode 18` (poprzednio 1.1.5 / 17) · Data przygotowania: 2026-10-24, uzupełnione o selekcję pod klienta 2026-10-25

Zasady jak w `whats-new-1.1.1.md`: bez emoji (bullet `•` dozwolony), opis = faktyczne działanie,
żadnej obietnicy wygranej ani „szansy w procentach".

Zakres wydania: „aplikacja robi papiery za Ciebie" — dane firmy wpisujesz raz, resztę dokumentów
oferty, odpowiedzi na wezwania i pism do zamawiającego dostajesz gotowe do podpisu. Prawie wszystko
liczy się na telefonie; SWZ z pliku PDF wymaga wdrożenia backendu Railway (gałąź zawiera zmianę trasy /swz/.../analiza). Gałęzie `feat/robi-za-ciebie` + `feat/pracownik` (selekcja pod klienta, scalone 2026-10-25 do integ/1.1.2).
Uwaga: numer wersji i versionCode podbić dopiero przy buildzie (app.json ORAZ android/app/build.gradle).

## What's New — PL (App Store „Co nowego" / Google Play „Informacje o wersji")

```
• Dokumenty do oferty w 1 klik: formularz ofertowy i oświadczenia (art. 125, grupa kapitałowa, aktualność informacji) z danych firmy wpisanych raz.
• Wpisz NIP, a nazwę, adres, REGON i KRS wstawimy z Białej listy VAT.
• Odpowiedź na wezwanie w 1 klik: wklej wezwanie, a rozpoznamy podstawę i termin i złożymy pismo z listą załączników.
• Wykaz wykonanych robót, usług lub dostaw powstaje z Banku referencji — tylko doświadczenie aktualne na dziś.
• Pytania z Radaru SWZ składają się w gotowy wniosek o wyjaśnienie treści specyfikacji.
• Pełnomocnictwo do złożenia oferty, gdy podpisuje pełnomocnik.
• Wklej tabelę formularza cenowego z SWZ — pozycje same trafią do sprawdzarki.
• Wniosek o zwrot wadium po przegranej, odrzuceniu lub wycofaniu oferty.
• Po wygranej: checklista pierwszych dni kontraktu oraz zgłoszenie podwykonawcy, wniosek o zmianę terminu i o zwrot zabezpieczenia.
• Radar SWZ przyjmuje plik PDF z telefonu — bez kopiowania tekstu.
• Karta decyzji „startować czy odpuścić” wypełnia się z ogłoszenia: termin, wadium, wartość, konkurencja.
• Kalkulator ceny pokazuje, gdzie Twoja cena leży na tle rozstrzygnięć w branży i regionie.
• Dla przetargów unijnych: ściąga do JEDZ z danymi firmy, sekcja po sekcji.
• Aktywne wezwanie zamawiającego widoczne w Kalendarzu terminów.
• Przypomnienia o terminie składania przychodzą e-mailem, gdy powiadomienia push nie są włączone.
• Twoje przetargi: aplikacja sama wybiera z nowych ogłoszeń te, które pasują do Twojej firmy, i mówi dlaczego — resztę odkłada z podaną przyczyną.
• Karta firmy w 5 krokach: czym się zajmujesz, gdzie działasz, jakie zlecenia Ci odpowiadają; selekcja uczy się z Twoich zapisów i odrzuceń.
• Warunki udziału przy każdym wybranym przetargu porównane z Twoją kartą oraz plan działania krok po kroku do terminu złożenia.
• Powiadomienia o wybranych przetargach: w planie Standard od razu, w planie Free raz dziennie, nigdy w nocy.
• E-mail z wybranymi przetargami i 7-dniowa próba planu Standard po rejestracji.
• Lista odrzuconych z możliwością przywrócenia jednym dotknięciem.
```

## What's New — EN

```
• Bid documents in one tap: the offer form and the statements (art. 125, capital group, information currency) from company details entered once.
• Enter your tax ID and we fill in the company name, address and registry numbers from the official VAT register.
• Reply to a buyer's request in one tap: paste the request, we detect the legal basis and the deadline, and draft the cover letter with the list of attachments.
• The list of completed works, services or supplies is built from your reference bank — only experience still valid today.
• Questions from the tender-document radar turn into a ready request for clarification of the specification.
• Power of attorney for submitting the bid when a proxy signs.
• Paste the price form table from the tender documents and the items land in the price checker.
• Request for the return of the bid bond after losing, rejection or withdrawal.
• After winning: a checklist for the first days of the contract plus a subcontractor notice, a deadline change request and a performance security return request.
• The tender-document radar accepts a PDF file from your phone — no copying text.
• The go/no-go decision card fills itself from the notice: deadline, bid bond, value, competition.
• The price calculator shows where your price sits against awards in your sector and region.
• For EU tenders: an ESPD cheat sheet with your company details, section by section.
• An active buyer's request is visible in the deadline calendar.
• Submission deadline reminders arrive by e-mail when push notifications are not enabled.
• Your tenders: the app picks the new notices that fit your company and says why — the rest is set aside with a stated reason.
• Company card in 5 steps: what you do, where you work, which jobs suit you; the selection learns from what you save and reject.
• Participation conditions for every selected tender compared with your card, plus a step-by-step action plan up to the submission deadline.
• Notifications about selected tenders: immediately on Standard, once a day on Free, never at night.
• E-mail with selected tenders and a 7-day Standard trial after sign-up.
• List of rejected tenders with one-tap restore.
```

## Sklepowe pola bez zmian

Tytuł, podtytuł, słowa kluczowe i opis jak w `listing.md`. Cena planu Standard: 99 zł/mc (od 2026-10-03).
