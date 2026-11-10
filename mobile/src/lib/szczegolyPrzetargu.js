/*
 * EKRAN SZCZEGÓŁÓW PRZETARGU — decyzja i narzędzia (2026-11-10, przegląd oczami pracownika).
 *
 * Było: ~12 ekranów przewijania, a to, co decyduje (dlaczego wybrany, warunki, dokumenty), na samym dole pod
 * kilkunastoma linkami do kalkulatorów; „Odrzuć” na końcu, „Zapisz” w środku, przypomnienie osobnym przełącznikiem.
 * Na prod 7–10.11 nikt nie zapisał ani nie odrzucił przetargu. Teraz: na dole ekranu stale „Biorę” i „Nie dla nas”,
 * a narzędzia w jednej zwiniętej sekcji, w grupach według etapu. CZYSTA logika; ekran: screens/MatchDetailScreen.js.
 */
import { STATUS_DOMYSLNY } from './statusPrzetargu.js';

/** Etapy, po których decyzja „biorę / nie dla nas” jest już za nami — pasek znika. */
const PO_DECYZJI = new Set(['zlozona', 'wygrana', 'przegrana']);

/**
 * Pasek decyzji na dole ekranu.
 * @returns {{widoczny: boolean, glowna?: {etykieta: {pl: string, en: string}, akcja: 'biore'|null},
 *   podpis?: {pl: string, en: string}|null}}
 */
export function pasekDecyzji({ zapisany = false, przypomnienie = false, status = STATUS_DOMYSLNY, terminMinal = false, maTermin = true } = {}) {
  if (terminMinal || PO_DECYZJI.has(status)) return { widoczny: false };
  const wziety = zapisany && status === 'przygotowuje';
  if (wziety) {
    return {
      widoczny: true,
      glowna: { etykieta: { pl: 'Bierzesz', en: 'Bidding' }, akcja: null },
      podpis: przypomnienie
        ? { pl: 'Jest w Zapisanych. Przypomnimy 7, 3 i 1 dzień przed terminem.', en: 'It is in Saved. We will remind you 7, 3 and 1 day before the deadline.' }
        : maTermin
          ? { pl: 'Jest w Zapisanych. Przypomnienie przed terminem włączysz niżej.', en: 'It is in Saved. Turn on the deadline reminder below.' }
          : { pl: 'Jest w Zapisanych.', en: 'It is in Saved.' },
    };
  }
  return {
    widoczny: true,
    glowna: { etykieta: { pl: 'Biorę', en: 'I will bid' }, akcja: 'biore' },
    podpis: null,
  };
}

/**
 * Co robi „Biorę”, żeby leniwy użytkownik nie musiał klikać trzech rzeczy: zapis, przypomnienie 7/3/1
 * (gdy jest przyszły termin) i etap „Przygotowuję ofertę” — tylko z etapu domyślnego, późniejszego nie cofamy.
 * @returns {Array<'zapisz'|'przypomnienie'|'etap'>} w tej kolejności (przypomnienie i etap wymagają zapisu)
 */
export function krokiBiore({ zapisany = false, przypomnienie = false, maTermin = false, status = STATUS_DOMYSLNY } = {}) {
  const kroki = [];
  if (!zapisany) kroki.push('zapisz');
  if (maTermin && !przypomnienie) kroki.push('przypomnienie');
  if (status === STATUS_DOMYSLNY) kroki.push('etap');
  return kroki;
}

const p = (pl, en) => ({ pl, en });

/*
 * Narzędzia do tej oferty — jedna lista zamiast pięciu kart i szesnastu wierszy. `ekran` = nazwa trasy; parametry
 * dokłada ekran szczegółów (zależą od przetargu i danych z API). Narzędzia „po wygranej” (zwrot zabezpieczenia,
 * odsetki) dopiero po etapie „Wygrana” — wcześniej nikt ich nie potrzebuje.
 */
const DECYZJA = [
  { ekran: 'KartaDecyzji', tytul: p('Startować czy odpuścić?', 'Bid or pass?'), opis: p('Werdykt GO / ROZWAŻ / ODPUŚĆ z czerwonymi flagami', 'A GO / CONSIDER / PASS verdict with red flags') },
  { ekran: 'CzyWarto', tytul: p('Czy warto tu startować', 'Is it worth bidding here'), opis: p('Ile firm startuje u tego zamawiającego i jaka cena wygrywa', 'How many firms bid here and what price wins') },
  { ekran: 'SymulatorPlynnosci', tytul: p('Symulator płynności', 'Cash-flow simulator'), opis: p('Ile własnej gotówki wyłożysz do pierwszej faktury', 'How much of your own cash you need until the first invoice') },
];
const OFERTA = [
  { ekran: 'SciezkaDoOferty', tytul: p('Krok po kroku do oferty', 'Step by step to your bid') },
  { ekran: 'ChecklistaOferty', tytul: p('Co muszę mieć do dnia składania', 'What I need by submission day') },
  { ekran: 'DokumentyOferty', tytul: p('Dokumenty do oferty w 1 klik', 'Bid documents in one tap') },
  { ekran: 'KalkulatorCeny', tytul: p('Kalkulator ceny ofertowej', 'Bid price calculator') },
  { ekran: 'SprawdzarkaCeny', tytul: p('Sprawdzarka formularza cenowego', 'Price form checker') },
  { ekran: 'KalkulatorPunktow', tytul: p('Kalkulator punktów (cena punktu)', 'Points calculator (price per point)') },
  { ekran: 'SymulatorPunktacji', tytul: p('Symulator punktacji oferty', 'Bid scoring simulator') },
  { ekran: 'KontrolerGwarancji', tytul: p('Kontroler gwarancji wadialnej', 'Bid security guarantee checker') },
  { ekran: 'KontrolaOferty', tytul: p('Lista kontrolna przed wysłaniem', 'Pre-submission checklist') },
  { ekran: 'RejestratorOferty', tytul: p('Rejestrator oferty', 'Bid recorder'), opis: p('Utrwala dowody na wypadek awarii platformy', 'Preserves evidence in case the platform fails') },
];
const PISMA = [
  { ekran: 'OdpowiedzNaWezwanie', tytul: p('Odpowiedź na wezwanie w 1 klik', 'Reply to a request in one tap') },
  { ekran: 'StraznikWezwania', tytul: p('Strażnik wezwania do uzupełnienia', 'Supplement request guard') },
  { ekran: 'ObronaCeny', tytul: p('Asystent obrony ceny (art. 224)', 'Low-price defence assistant (Art. 224)') },
  { ekran: 'KaryUmowne', tytul: p('Kalkulator kar umownych', 'Contractual penalties calculator') },
  { ekran: 'TerminZwiazania', tytul: p('Strażnik terminu związania ofertą', 'Bid validity period guard') },
  { ekran: 'WizjaLokalna', tytul: p('Wykrywacz obowiązkowej wizji lokalnej', 'Mandatory site visit detector') },
  { ekran: 'Konsorcjum', tytul: p('Strażnik oświadczenia konsorcjum (art. 117)', 'Consortium statement guard (Art. 117)') },
  { ekran: 'Tajemnica', tytul: p('Tarcza tajemnicy przedsiębiorstwa', 'Trade secret shield') },
  { ekran: 'Samooczyszczenie', tytul: p('Kreator samooczyszczenia (art. 110)', 'Self-cleaning wizard (Art. 110)') },
  { ekran: 'Kreator118', tytul: p('Pożycz doświadczenie (art. 118)', 'Borrow experience (Art. 118)') },
  { ekran: 'KalkulatorTerminow', tytul: p('Kalkulator terminów (dni robocze, święta)', 'Deadline calculator (working days, holidays)') },
];
const PO_WYGRANEJ = [
  { ekran: 'PoWygranej', tytul: p('Po wygranej: pierwsze dni kontraktu', 'After winning: the first days of the contract') },
  { ekran: 'ZabezpieczenieZwrot', tytul: p('Odzyskaj zabezpieczenie', 'Get your performance security back') },
  { ekran: 'KalkulatorOdsetek', tytul: p('Odsetki za opóźnienie + rekompensata', 'Late payment interest + compensation') },
];

/**
 * @param {{status?: string, maChecklista?: boolean}} stan `maChecklista` — przetarg ma identyfikator dla checklisty
 * @returns {{klucz: string, tytul: {pl: string, en: string}, pozycje: object[]}[]}
 */
export function grupyNarzedzi({ status = STATUS_DOMYSLNY, maChecklista = true } = {}) {
  const grupy = [
    { klucz: 'decyzja', tytul: p('Decyzja', 'Decision'), pozycje: DECYZJA },
    { klucz: 'oferta', tytul: p('Przygotowanie oferty', 'Preparing the bid'), pozycje: OFERTA.filter((n) => maChecklista || n.ekran !== 'ChecklistaOferty') },
    { klucz: 'pisma', tytul: p('Pisma, kary i terminy', 'Letters, penalties and deadlines'), pozycje: PISMA },
  ];
  if (status === 'wygrana') grupy.unshift({ klucz: 'po_wygranej', tytul: p('Po wygranej', 'After winning'), pozycje: PO_WYGRANEJ });
  return grupy;
}

/** Liczba narzędzi w grupach — do nagłówka zwiniętej sekcji. */
export const liczbaNarzedzi = (grupy) => grupy.reduce((s, g) => s + g.pozycje.length, 0);
