/**
 * „Ścieżka do wygranej" — przewodnik krok po kroku, jak przygotować i złożyć konkurencyjną
 * ofertę w przetargu. Spina rozproszone narzędzia aplikacji w jedną, uporządkowaną drogę:
 * każdy krok mówi, CO zrobić, i prowadzi do właściwego narzędzia. Postęp jest zapisywany
 * per przetarg (checklista).
 *
 * Czysta logika (budowa ścieżki + postęp) jest testowalna; I/O storage wstrzykiwane
 * jak w poprzetargowaKontrola. `ekran` = nazwa ekranu z RootNavigatora (skrót do narzędzia).
 */

import { zarejestrujKlucz } from './daneLokalne.js';

/** Fazy w kolejności prezentacji — od rozeznania do rozstrzygnięcia. */
export const FAZY = [
  'Rozeznanie',
  'Decyzja: startować?',
  'Dokumenty',
  'Oferta',
  'Złożenie',
  'Po złożeniu',
  'Rozstrzygnięcie',
];

/**
 * Kroki ścieżki. `opcjonalny: true` = dotyczy tylko części wykonawców (nie liczy się do
 * paska postępu, ale można odhaczyć). `ekran` = dokąd prowadzi przycisk „Otwórz narzędzie".
 * `dodatkowe` = dalsze wejścia w tym samym kroku — ekrany, które potrzebują KONTEKSTU
 * przetargu (patrz `parametryNarzedzia`), więc pokazujemy je tylko, gdy ten kontekst jest.
 */
export const KROKI = [
  { klucz: 'swz', faza: 'Rozeznanie', ekran: 'RadarSwz',
    tytul: 'Przeczytaj SWZ i zrozum zamówienie',
    opis: 'Sprawdź przedmiot, zakres, warunki udziału i kryteria oceny. Radar SWZ wyłapie pytania i zmiany specyfikacji, których nie wolno przegapić.' },
  { klucz: 'kwalifikacja', faza: 'Rozeznanie', ekran: 'BankReferencji',
    tytul: 'Sprawdź, czy się kwalifikujesz',
    opis: 'Zweryfikuj warunki udziału (doświadczenie, potencjał) i brak podstaw wykluczenia. Upewnij się, że masz aktualne referencje na wymagany zakres i wartość.' },

  { klucz: 'oplacalnosc', faza: 'Decyzja: startować?', ekran: 'SymulatorPlynnosci',
    dodatkowe: [{ ekran: 'CzyWarto', etykieta: 'Sprawdź, czy warto tu startować' }],
    tytul: 'Policz, czy to się opłaca',
    opis: 'Zanim włożysz pracę: sprawdź, za ile robi się to w Twoim regionie i czy udźwigniesz płynność — ile własnej gotówki wyłożysz, zanim zapłaci zamawiający.' },
  { klucz: 'punkty', faza: 'Decyzja: startować?', ekran: 'KalkulatorPunktow',
    tytul: 'Ustal, czym wygrasz (nie musisz być najtańszy)',
    opis: 'Policz „cenę punktu": o ile drożej możesz dać, nadrabiając kryteriami pozacenowymi (termin, gwarancja, jakość).' },

  { klucz: 'wadium', faza: 'Dokumenty', ekran: 'KontrolerGwarancji',
    tytul: 'Zabezpiecz wadium',
    opis: 'Jeśli wymagane — wnieś wadium w terminie i właściwej formie. Gwarancją? Przekontroluj jej treść, żeby nie odpaść formalnie.' },
  { klucz: 'dokumenty', faza: 'Dokumenty', ekran: 'Sejf',
    dodatkowe: [{ ekran: 'ChecklistaOferty', etykieta: 'Co muszę mieć do dnia składania' }],
    tytul: 'Skompletuj dokumenty',
    opis: 'Przygotuj oświadczenia (JEDZ / oświadczenie własne), pełnomocnictwa i podmiotowe środki dowodowe. Trzymaj je w Sejfie z pilnowaniem ważności.' },
  { klucz: 'konsorcjum', faza: 'Dokumenty', ekran: 'Konsorcjum', opcjonalny: true,
    tytul: 'Konsorcjum lub podmiot trzeci',
    opis: 'Startujesz z partnerem albo cudzym potencjałem? Dołącz właściwe oświadczenia i zobowiązania (art. 117 / 118).' },

  { klucz: 'oferta', faza: 'Oferta', ekran: 'ObronaCeny',
    tytul: 'Zbuduj wygrywającą ofertę',
    opis: 'Skalkuluj cenę pod kryteria. Jeśli Twoja cena jest niska — przygotuj uzasadnienie na wypadek zarzutu rażąco niskiej ceny (art. 224).' },
  { klucz: 'tajemnica', faza: 'Oferta', ekran: 'Tajemnica', opcjonalny: true,
    tytul: 'Zastrzeż tajemnicę (jeśli dotyczy)',
    opis: 'Chcesz utajnić know-how lub kalkulację? Uzasadnij wszystkie trzy przesłanki tajemnicy przedsiębiorstwa — inaczej zamawiający odtajni.' },
  { klucz: 'wizja', faza: 'Oferta', ekran: 'WizjaLokalna', opcjonalny: true,
    tytul: 'Sprawdź obowiązkową wizję lokalną',
    opis: 'Jeśli SWZ wymaga wizji lokalnej, jej brak = odrzucenie oferty (art. 226 ust. 1 pkt 18). Zaplanuj ją zawczasu.' },

  { klucz: 'termin', faza: 'Złożenie', ekran: 'KalkulatorTerminow',
    tytul: 'Policz termin i złóż z zapasem',
    opis: 'Wylicz termin składania z uwzględnieniem dni wolnych. Złóż ofertę z zapasem 24 h przed terminem — nie w ostatniej chwili.' },
  { klucz: 'rejestrator', faza: 'Złożenie', ekran: 'RejestratorOferty',
    tytul: 'Utrwal dowody podczas składania',
    opis: 'Włącz rejestrator: prowadzi wysyłkę krok po kroku i utrwala dowody (zrzuty, suma kontrolna). Gdy platforma zawiedzie — jednym ruchem złożysz pakiet i pismo o przedłużenie terminu.' },

  { klucz: 'zwiazanie', faza: 'Po złożeniu', ekran: 'TerminZwiazania',
    tytul: 'Pilnuj terminu związania i wadium',
    opis: 'Po złożeniu jesteś związany ofertą — dopilnuj, by wadium pokrywało cały okres, i reaguj na wezwania do przedłużenia.' },
  { klucz: 'wezwania', faza: 'Po złożeniu', ekran: 'StraznikWezwania',
    tytul: 'Reaguj na wezwania w terminie',
    opis: 'Wezwanie do uzupełnienia lub wyjaśnień ma krótki termin — przegapione = odpadasz formalnie. Odlicz czas i skompletuj odpowiedź.' },

  { klucz: 'wynik', faza: 'Rozstrzygnięcie', ekran: 'KalkulatorTerminow',
    tytul: 'Sprawdź wynik i rozważ odwołanie',
    opis: 'Po wyborze oferty: jeśli przegrałeś nieznacznie, prześwietl ofertę zwycięzcy (ustaw etap „Przegrana" w szczegółach) i policz termin na odwołanie do KIO.' },
];

/** Zbiór kluczy z dowolnego wejścia (Set, tablica, śmieci → pusty zbiór). */
function jakoZbior(wykonane) {
  return wykonane instanceof Set ? wykonane : new Set(Array.isArray(wykonane) ? wykonane : []);
}

/**
 * JEDNO następne działanie: pierwszy WYMAGANY krok, który nie jest odhaczony — w kolejności
 * ścieżki. Kroki opcjonalne pomijamy (dotyczą części wykonawców). `null` znaczy tylko tyle,
 * że użytkownik odhaczył wszystkie wymagane kroki przewodnika; o kompletności OFERTY nie
 * mówi to nic — przewodnik nie widzi jej treści.
 * @param {Set<string>|string[]} wykonane klucze ukończonych kroków
 * @returns {object|null} krok z `KROKI` albo null
 */
export function nastepnyKrok(wykonane) {
  const zbior = jakoZbior(wykonane);
  return KROKI.find((k) => !k.opcjonalny && !zbior.has(k.klucz)) ?? null;
}

/** Niepusty napis albo null (białe znaki to też „brak"). */
function tekstLubNull(wartosc) {
  return typeof wartosc === 'string' && wartosc.trim() ? wartosc : null;
}

/** Identyfikator: niepusty napis albo skończona liczba; wszystko inne → null. */
function idLubNull(wartosc) {
  if (typeof wartosc === 'number') return Number.isFinite(wartosc) ? wartosc : null;
  return tekstLubNull(wartosc);
}

/**
 * Parametry nawigacji do narzędzia otwieranego Z KONTEKSTU przetargu (ścieżka, szczegóły).
 *
 * Do 2026-10-03 ścieżka przekazywała każdemu narzędziu wyłącznie `{ nazwa }`. Ekrany, które
 * adresują dane identyfikatorem (checklista, „czy warto"), nie miały jak się otworzyć, a
 * Radar SWZ kazał przepisywać nazwę i daty, które przetarg już zna.
 *
 * Zwraca `null`, gdy ekran WYMAGA identyfikatora, a kontekst go nie ma — wołający nie
 * pokazuje wtedy wejścia, zamiast otwierać ekran, który skończy się błędem. Dla pozostałych
 * narzędzi zachowanie jak dotąd: `{ nazwa }` albo pusty obiekt.
 *
 * @param {string} ekran nazwa trasy z RootNavigatora
 * @param {object|null|undefined} match dopasowanie z `tender` (może być niepełne)
 * @returns {object|null}
 */
export function parametryNarzedzia(ekran, match) {
  const m = match && typeof match === 'object' ? match : {};
  const tender = m.tender && typeof m.tender === 'object' ? m.tender : {};
  const tenderId = idLubNull(tender.id) ?? idLubNull(m.tender_id);
  const matchId = idLubNull(m.id);
  const tytul = tekstLubNull(tender.title);
  const termin = tekstLubNull(tender.deadline);
  const dataOgloszenia = tekstLubNull(tender.published_at);

  switch (ekran) {
    case 'ChecklistaOferty':
      if (tenderId === null) return null;
      return tytul ? { tenderId, tytul } : { tenderId };
    case 'CzyWarto': {
      if (tenderId === null && matchId === null) return null;
      const params = { matchId, tenderId };
      if (tytul) params.tytul = tytul;
      return params;
    }
    case 'RadarSwz': {
      // Tylko to, co ogłoszenie realnie podaje — formularz Radaru zostaje edytowalny.
      // `tenderId` pozwala Radarowi powiązać nową analizę z tym przetargiem (checklista).
      const params = {};
      if (tenderId !== null) params.tenderId = tenderId;
      if (tytul) params.nazwa = tytul;
      if (termin) params.termin = termin;
      if (dataOgloszenia) params.dataOgloszenia = dataOgloszenia;
      return params;
    }
    case 'RejestratorOferty':
      return { termin: termin ?? undefined, postepowanieId: matchId ?? undefined, nazwa: tytul ?? undefined };
    default:
      return tytul ? { nazwa: tytul } : {};
  }
}

/**
 * Buduje ścieżkę z odhaczeniem wykonanych kroków i policzeniem postępu.
 * @param {Set<string>|string[]} wykonane klucze ukończonych kroków
 * @returns {{fazy: Array<{nazwa: string, kroki: object[]}>, nastepny: object|null,
 *   postep: {wymagane: number, zrobione: number, procent: number, wszystkieWymaganeGotowe: boolean}}}
 */
export function zbudujSciezke(wykonane) {
  const zbior = jakoZbior(wykonane);
  const kroki = KROKI.map((k) => ({ ...k, wykonany: zbior.has(k.klucz) }));

  // Pasek postępu liczy TYLKO kroki wymagane — odhaczenie opcjonalnego nie „nabija" postępu.
  const wymagane = kroki.filter((k) => !k.opcjonalny);
  const zrobione = wymagane.filter((k) => k.wykonany).length;

  const fazy = FAZY
    .map((nazwa) => ({ nazwa, kroki: kroki.filter((k) => k.faza === nazwa) }))
    .filter((f) => f.kroki.length);

  return {
    fazy,
    nastepny: nastepnyKrok(zbior),
    postep: {
      wymagane: wymagane.length,
      zrobione,
      procent: wymagane.length ? Math.round((100 * zrobione) / wymagane.length) : 0,
      wszystkieWymaganeGotowe: zrobione === wymagane.length,
    },
  };
}

/** Klucz storage per przetarg. SecureStore dopuszcza tylko [A-Za-z0-9._-] — czyścimy id. */
export function kluczSciezki(tenderId) {
  return `przetargai.sciezka.${String(tenderId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** Wczytuje zbiór ukończonych kroków (storage wstrzykiwany). Błąd/brak → pusty zbiór. */
export async function wczytajSciezke(storage, tenderId) {
  try {
    const raw = await storage.getItem(kluczSciezki(tenderId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/** Zapisuje zbiór ukończonych kroków. */
export async function zapiszSciezke(storage, tenderId, wykonane) {
  const arr = [...(wykonane instanceof Set ? wykonane : new Set(Array.isArray(wykonane) ? wykonane : []))];
  // Klucz per przetarg → do indeksu konta, żeby wylogowanie go skasowało (2026-09-25).
  const klucz = kluczSciezki(tenderId);
  await zarejestrujKlucz(storage, klucz);
  await storage.setItem(klucz, JSON.stringify(arr));
}
