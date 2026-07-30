/**
 * Katalog wszystkich narzędzi aplikacji, pogrupowany wg fazy pracy nad przetargiem.
 * Zasila ekran „Narzędzia" (hub) — z ~30 narzędziami rozsypanymi po ekranach użytkownik
 * inaczej ich nie znajdzie. `ekran` = nazwa trasy w RootNavigator (branża zalogowana).
 */
export const KATALOG_NARZEDZI = [
  {
    kategoria: 'Decyzja: startować?',
    narzedzia: [
      { ekran: 'KartaDecyzji', tytul: 'Startować czy odpuścić?', opis: 'Werdykt GO / ROZWAŻ / ODPUŚĆ z czerwonymi flagami' },
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
    ],
  },
  {
    kategoria: 'Dokumenty i kwalifikacja',
    narzedzia: [
      { ekran: 'Sejf', tytul: 'Sejf dokumentów', opis: 'Licznik ważności zaświadczeń (US, ZUS, KRK…)' },
      { ekran: 'BankReferencji', tytul: 'Bank referencji', opis: 'Pilnuje „terminu przydatności" doświadczenia' },
      { ekran: 'CertyfikatWykonawcy', tytul: 'Certyfikat wykonawcy', opis: 'Czy się opłaca (ustawa od 12.07.2026)' },
      { ekran: 'KontrolerGwarancji', tytul: 'Kontroler gwarancji wadialnej', opis: 'Wadium gwarancją, które nie odpadnie' },
      { ekran: 'Konsorcjum', tytul: 'Oświadczenie konsorcjum (art. 117)', opis: 'Kto co wykona' },
      { ekran: 'Tajemnica', tytul: 'Tarcza tajemnicy przedsiębiorstwa', opis: 'Skuteczne zastrzeżenie albo świadome odpuszczenie' },
      { ekran: 'Samooczyszczenie', tytul: 'Kreator samooczyszczenia (art. 110)', opis: 'Druga szansa po karze/zerwanej umowie' },
    ],
  },
  {
    kategoria: 'Terminy',
    narzedzia: [
      { ekran: 'KalkulatorTerminow', tytul: 'Kalkulator terminów Pzp', opis: 'Dni robocze i święta, przesunięcie z dnia wolnego' },
      { ekran: 'KalendarzTerminow', tytul: 'Kalendarz terminów', opis: 'Oś czasu terminów z zapisanych' },
      { ekran: 'TerminZwiazania', tytul: 'Strażnik terminu związania', opis: 'Nie wypadnij przez przegapione pismo' },
      { ekran: 'StraznikWezwania', tytul: 'Strażnik wezwania do uzupełnienia', opis: 'Krótki termin, jedna szansa (art. 128)' },
      { ekran: 'WizjaLokalna', tytul: 'Wykrywacz obowiązkowej wizji lokalnej', opis: 'Brak wizji = odrzucenie' },
    ],
  },
  {
    kategoria: 'Oferta i złożenie',
    narzedzia: [
      { ekran: 'KontrolaOferty', tytul: 'Kontrola przed wysłaniem', opis: 'Lista formalnych pułapek, przez które oferty odpadają' },
      { ekran: 'RejestratorOferty', tytul: 'Rejestrator oferty', opis: 'Utrwal dowody na wypadek awarii platformy' },
      { ekran: 'RadarSwz', tytul: 'Radar SWZ', opis: 'Pytania do SWZ i zmiany specyfikacji' },
      { ekran: 'PrzeswietlenieUmowy', tytul: 'Prześwietlenie umowy', opis: 'Pułapki i kary przed podpisem' },
    ],
  },
  {
    kategoria: 'Moje postępowania',
    narzedzia: [
      { ekran: 'Pulpit', tytul: 'Pulpit — moje postępowania', opis: 'Widok etapowy prowadzonych ofert' },
      { ekran: 'Saved', tytul: 'Zapisane przetargi', opis: 'Zakładki, etapy i przypomnienia' },
      { ekran: 'PodprogoweUstawienia', tytul: 'Radar zamówień podprogowych', opis: 'Zakupy poniżej progu Pzp — łatwiejszy start' },
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
