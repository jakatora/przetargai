/**
 * Katalog wszystkich narzędzi aplikacji, pogrupowany wg fazy pracy nad przetargiem.
 * Zasila ekran „Narzędzia" (hub) — z ~30 narzędziami rozsypanymi po ekranach użytkownik
 * inaczej ich nie znajdzie. `ekran` = nazwa trasy w RootNavigator (branża zalogowana).
 */
export const KATALOG_NARZEDZI = [
  {
    kategoria: 'Zanim ogłoszą',
    narzedzia: [
      { ekran: 'RadarPlanow', tytul: 'Radar planów zamówień', opis: 'Przetargi zapowiedziane w TED — przygotuj się, zanim wyjdą' },
    ],
  },
  {
    kategoria: 'Decyzja: startować?',
    narzedzia: [
      { ekran: 'KartaDecyzji', tytul: 'Startować czy odpuścić?', opis: 'Werdykt GO / ROZWAŻ / ODPUŚĆ z czerwonymi flagami' },
      { ekran: 'TwoiKonkurenci', tytul: 'Twoi konkurenci', opis: 'Kto najczęściej wygrywa w Twoich branżach i regionach — z profilem każdej firmy' },
      { ekran: 'SymulatorPlynnosci', tytul: 'Symulator płynności', opis: 'Czy udźwigniesz kontrakt do pierwszej faktury' },
      { ekran: 'KalkulatorPunktow', tytul: 'Kalkulator punktów', opis: 'Cena punktu — o ile drożej wygrasz jakością' },
      { ekran: 'SymulatorPunktacji', tytul: 'Symulator punktacji oferty', opis: 'Ile punktów realnie zdobędziesz' },
    ],
  },
  {
    kategoria: 'Cena i finanse',
    narzedzia: [
      { ekran: 'KalkulatorCeny', tytul: 'Kalkulator ceny ofertowej', opis: 'Zbuduj cenę od kosztów do brutto' },
      { ekran: 'SprawdzarkaCeny', tytul: 'Sprawdzarka formularza cenowego', opis: 'Wyłap błędy rachunkowe i złą stawkę VAT' },
      { ekran: 'ObronaCeny', tytul: 'Obrona ceny (art. 224)', opis: 'Uzasadnij cenę przy zarzucie rażąco niskiej' },
      { ekran: 'KaryUmowne', tytul: 'Kalkulator kar umownych', opis: 'Maksymalne ryzyko kar przed podpisem' },
      { ekran: 'KalkulatorOdsetek', tytul: 'Odsetki za opóźnienie + rekompensata', opis: 'Gdy zamawiający płaci po terminie' },
      { ekran: 'ZabezpieczenieZwrot', tytul: 'Odzyskiwacz zabezpieczenia', opis: 'Zwrot 5% kontraktu po realizacji' },
      { ekran: 'ZwrotWadium', tytul: 'Wniosek o zwrot wadium', opis: 'Po przegranej, odrzuceniu lub wycofaniu oferty — pismo w 1 klik, zwrot w 7 dni (art. 98 ust. 2)' },
    ],
  },
  {
    kategoria: 'Dokumenty i kwalifikacja',
    narzedzia: [
      { ekran: 'Sejf', tytul: 'Sejf dokumentów', opis: 'Licznik ważności zaświadczeń (US, ZUS, KRK…)' },
      { ekran: 'BankReferencji', tytul: 'Bank referencji', opis: 'Pilnuje „terminu przydatności" doświadczenia' },
      { ekran: 'BankOsob', tytul: 'Bank osób', opis: 'Kadra z uprawnieniami wpisana raz → wykaz osób w 1 klik' },
      { ekran: 'CertyfikatWykonawcy', tytul: 'Certyfikat wykonawcy', opis: 'Czy się opłaca (ustawa od 12.07.2026)' },
      { ekran: 'KontrolerGwarancji', tytul: 'Kontroler gwarancji wadialnej', opis: 'Wadium gwarancją, które nie odpadnie' },
      { ekran: 'Konsorcjum', tytul: 'Oświadczenie konsorcjum (art. 117)', opis: 'Kto co wykona' },
      { ekran: 'Tajemnica', tytul: 'Tarcza tajemnicy przedsiębiorstwa', opis: 'Skuteczne zastrzeżenie albo świadome odpuszczenie' },
      { ekran: 'Samooczyszczenie', tytul: 'Kreator samooczyszczenia (art. 110)', opis: 'Druga szansa po karze/zerwanej umowie' },
      { ekran: 'Kreator118', tytul: 'Pożycz doświadczenie (art. 118)', opis: 'Kreator zobowiązania podmiotu udostępniającego zasoby' },
    ],
  },
  {
    kategoria: 'Terminy',
    narzedzia: [
      { ekran: 'KalkulatorTerminow', tytul: 'Kalkulator terminów Pzp', opis: 'Dni robocze i święta, przesunięcie z dnia wolnego' },
      { ekran: 'KalendarzTerminow', tytul: 'Kalendarz terminów', opis: 'Pytania do SWZ, składanie ofert, koniec związania — z kartą następnego kroku' },
      { ekran: 'TerminZwiazania', tytul: 'Strażnik terminu związania', opis: 'Nie wypadnij przez przegapione pismo' },
      { ekran: 'StraznikWezwania', tytul: 'Strażnik wezwania do uzupełnienia', opis: 'Krótki termin, jedna szansa (art. 128)' },
      { ekran: 'WizjaLokalna', tytul: 'Wykrywacz obowiązkowej wizji lokalnej', opis: 'Brak wizji = odrzucenie' },
    ],
  },
  {
    kategoria: 'Oferta i złożenie',
    narzedzia: [
      { ekran: 'DokumentyOferty', tytul: 'Dokumenty do oferty w 1 klik', opis: 'Formularz ofertowy i oświadczenia (art. 125, grupa kapitałowa) z danych firmy wpisanych raz' },
      { ekran: 'OdpowiedzNaWezwanie', tytul: 'Odpowiedź na wezwanie w 1 klik', opis: 'Wklej wezwanie (art. 128/274/223/224) — rozpoznamy termin i złożymy pismo z załącznikami' },
      { ekran: 'KontrolaOferty', tytul: 'Kontrola przed wysłaniem', opis: 'Lista formalnych pułapek, przez które oferty odpadają' },
      { ekran: 'RejestratorOferty', tytul: 'Rejestrator oferty', opis: 'Utrwal dowody na wypadek awarii platformy' },
      { ekran: 'TrenerNegocjacji', tytul: 'Trener negocjacji i oferty dodatkowej', opis: 'Tryb podstawowy w2/w3 — oferta dodatkowa bez odrzucenia (art. 296)' },
      { ekran: 'RadarSwz', tytul: 'Radar SWZ', opis: 'Pytania do SWZ i zmiany specyfikacji' },
      { ekran: 'PrzeswietlenieUmowy', tytul: 'Prześwietlenie umowy', opis: 'Pułapki i kary przed podpisem' },
    ],
  },
  {
    kategoria: 'Po wygranej',
    narzedzia: [
      { ekran: 'PoWygranej', tytul: 'Po wygranej: pierwsze dni kontraktu', opis: 'Checklista + pisma w 1 klik: zgłoszenie podwykonawcy, zmiana terminu, zwrot zabezpieczenia' },
    ],
  },
  {
    kategoria: 'Moje postępowania',
    narzedzia: [
      { ekran: 'Pulpit', tytul: 'Pulpit — moje postępowania', opis: 'Widok etapowy prowadzonych ofert' },
      { ekran: 'Saved', tytul: 'Zapisane przetargi', opis: 'Zakładki, etapy i przypomnienia' },
      { ekran: 'PodprogoweUstawienia', tytul: 'Radar zamówień podprogowych', opis: 'Zakupy poniżej progu Pzp — łatwiejszy start' },
      { ekran: 'ZapisaneWyszukiwania', tytul: 'Zapisane wyszukiwania', opis: 'Obserwuj rynek: alert o nowych przetargach i o zmianach' },
      { ekran: 'CentrumAlertow', tytul: 'Alerty i zmiany', opis: 'Zmiany terminu, wartości i anulowania w jednym miejscu' },
    ],
  },
  {
    kategoria: 'Przewodniki',
    narzedzia: [
      { ekran: 'PrzewodnikStartu', tytul: 'Przewodnik startu: czy jesteś gotowy?', opis: 'Checklista wejścia dla firmy zaczynającej z przetargami' },
      { ekran: 'SciezkaDoOferty', tytul: 'Krok po kroku do wygranej', opis: 'Cała ścieżka od SWZ po złożenie (otwórz z przetargu)' },
    ],
  },
];
