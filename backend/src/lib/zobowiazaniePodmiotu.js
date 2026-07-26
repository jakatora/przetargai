import { isMainModule } from './ids.js';

/**
 * MODEL DANYCH „zobowiązanie podmiotu udostępniającego zasoby" (art. 118 ust. 4
 * Pzp) + walidacja kompletności pól — podzadanie 4/12 ulepszenia „Pożycz
 * doświadczenie: kreator polegania na zasobach podmiotu trzeciego".
 *
 * To CZYSTY model + czysta funkcja walidacji, bez UI i bez I/O. Opisuje, jakie
 * pola musi zawierać zobowiązanie, żeby zamawiający i KIO uznały udostępnienie
 * zasobów za REALNE, a nie fikcyjne. Art. 118 ust. 4 Pzp wymaga, by z zobowiązania
 * wynikało w szczególności:
 *   • zakres dostępnych wykonawcy zasobów podmiotu (pkt 1),
 *   • sposób ORAZ okres udostępnienia i wykorzystania zasobów przy wykonywaniu
 *     zamówienia (pkt 2),
 *   • czy i w jakim zakresie podmiot udostępniający — przy warunkach dotyczących
 *     wykształcenia, kwalifikacji lub DOŚWIADCZENIA — zrealizuje roboty budowlane
 *     lub usługi, których te zdolności dotyczą (pkt 3).
 * Do tego dochodzą dane identyfikujące sam podmiot (bez nich zobowiązania nie da
 * się przypisać ani wyegzekwować).
 *
 * Świadome decyzje modelu:
 *  • „Kompletność" to OBECNOŚĆ merytorycznej treści pola (niepusty string), NIE
 *    poprawność formatu (np. NIP) ani zgodność prawna — to zadanie osobnych
 *    kroków kreatora. Ten model odpowiada tylko na pytanie „czy nic nie pominięto".
 *  • `zakres_podwykonawstwa` (art. 118 ust. 4 pkt 3) jest tu WYMAGANY: cały kreator
 *    dotyczy pożyczania DOŚWIADCZENIA przy robotach/usługach, a wtedy podmiot musi
 *    realnie wykonać tę część zamówienia (art. 118 ust. 2). Puste to pole = pułapka
 *    „użyczenia samych referencji".
 *  • Dane podmiotu rozbite na pola: nazwa i identyfikator są WYMAGANE (bez nich nie
 *    ma kogo zobowiązać), adres i reprezentant są ZALECANE — ich brak daje
 *    ostrzeżenie, ale nie blokuje kompletności (formalny podpis podmiotu i złożenie
 *    z ofertą pilnuje osobny krok, patrz pułapki w kreatorze).
 *  • Model jest DEKLARATYWNY (`POLA_ZOBOWIAZANIA`) i GŁĘBOKO ZAMROŻONY — walidacja
 *    to jeden przebieg po tej liście, a UI może z niej wygenerować formularz.
 *  • Wynik walidacji jest ZAMROŻONY — to migawka oceny kompletności.
 */

/** Rekurencyjnie zamraża obiekt/tablicę wraz z zagnieżdżeniami. */
function deepFreeze(wartosc) {
  if (wartosc && typeof wartosc === 'object' && !Object.isFrozen(wartosc)) {
    for (const v of Object.values(wartosc)) deepFreeze(v);
    Object.freeze(wartosc);
  }
  return wartosc;
}

/** Czy wartość jest niepustym (po przycięciu spacji) stringiem. */
function niepustyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** Bezpiecznie czyta wartość spod ścieżki (np. ['dane_podmiotu','nazwa']). */
function odczytajSciezke(obiekt, sciezka) {
  let biezacy = obiekt;
  for (const segment of sciezka) {
    if (biezacy === null || typeof biezacy !== 'object') return undefined;
    biezacy = biezacy[segment];
  }
  return biezacy;
}

/** Stabilne identyfikatory pól — punkt zaczepienia dla UI, generatora i walidacji. */
export const ID_POL = Object.freeze({
  DANE_PODMIOTU_NAZWA: 'dane-podmiotu-nazwa',
  DANE_PODMIOTU_IDENTYFIKATOR: 'dane-podmiotu-identyfikator',
  DANE_PODMIOTU_ADRES: 'dane-podmiotu-adres',
  DANE_PODMIOTU_REPREZENTANT: 'dane-podmiotu-reprezentant',
  ZAKRES_DOSWIADCZENIA: 'zakres-doswiadczenia',
  SPOSOB_UDOSTEPNIENIA: 'sposob-udostepnienia',
  OKRES_UDOSTEPNIENIA: 'okres-udostepnienia',
  ZAKRES_PODWYKONAWSTWA: 'zakres-podwykonawstwa',
});

/**
 * @typedef {object} PoleZobowiazania
 * @property {string} id stabilny identyfikator (patrz {@link ID_POL}).
 * @property {string} etykieta krótka nazwa pola do UI.
 * @property {string} opis co wpisać i dlaczego (prostym językiem).
 * @property {string} podstawa podstawa prawna / uzasadnienie wymogu.
 * @property {boolean} wymagane czy brak pola czyni zobowiązanie niekompletnym.
 * @property {string[]} sciezka ścieżka wartości w obiekcie zobowiązania.
 * @property {string} [zalecenie] powód, dla którego pole zalecane warto wypełnić.
 */

/**
 * DEKLARATYWNY model pól zobowiązania. Tablica GŁĘBOKO ZAMROŻONA — walidacja to
 * jeden przebieg po niej, a UI może z niej wygenerować formularz.
 * @type {PoleZobowiazania[]}
 */
export const POLA_ZOBOWIAZANIA = deepFreeze([
  {
    id: ID_POL.DANE_PODMIOTU_NAZWA,
    etykieta: 'Nazwa (firma) podmiotu udostępniającego zasoby',
    opis:
      'Pełna nazwa firmy, która użycza swojego doświadczenia. Bez wskazania podmiotu '
      + 'nie ma kogo zobowiązać ani od kogo egzekwować udziału w realizacji.',
    podstawa: 'identyfikacja podmiotu udostępniającego (art. 118 ust. 3 i 4 Pzp)',
    wymagane: true,
    sciezka: ['dane_podmiotu', 'nazwa'],
  },
  {
    id: ID_POL.DANE_PODMIOTU_IDENTYFIKATOR,
    etykieta: 'Identyfikator podmiotu (NIP / KRS / REGON)',
    opis:
      'Numer jednoznacznie identyfikujący podmiot (NIP, a gdy brak — KRS lub REGON, '
      + 'przy podmiocie zagranicznym odpowiednik). Wiąże zobowiązanie z konkretną firmą.',
    podstawa: 'identyfikacja podmiotu udostępniającego (art. 118 ust. 3 i 4 Pzp)',
    wymagane: true,
    sciezka: ['dane_podmiotu', 'identyfikator'],
  },
  {
    id: ID_POL.DANE_PODMIOTU_ADRES,
    etykieta: 'Adres siedziby podmiotu',
    opis: 'Adres siedziby — potrzebny do korespondencji i pełnej identyfikacji podmiotu.',
    podstawa: 'identyfikacja podmiotu udostępniającego (art. 118 ust. 3 Pzp)',
    wymagane: false,
    sciezka: ['dane_podmiotu', 'adres'],
    zalecenie: 'Uzupełnij adres, by jednoznacznie zidentyfikować podmiot w ofercie.',
  },
  {
    id: ID_POL.DANE_PODMIOTU_REPREZENTANT,
    etykieta: 'Osoba reprezentująca podmiot (podpis)',
    opis:
      'Imię, nazwisko i funkcja osoby uprawnionej do reprezentacji — to ona podpisze '
      + 'zobowiązanie w imieniu podmiotu udostępniającego.',
    podstawa: 'zobowiązanie musi pochodzić od podmiotu i być przez niego podpisane (art. 118 ust. 3 Pzp)',
    wymagane: false,
    sciezka: ['dane_podmiotu', 'reprezentant'],
    zalecenie: 'Wskaż osobę reprezentującą — zobowiązanie musi podpisać sam podmiot udostępniający.',
  },
  {
    id: ID_POL.ZAKRES_DOSWIADCZENIA,
    etykieta: 'Zakres udostępnianego doświadczenia (zasobów)',
    opis:
      'Konkretnie, jakie doświadczenie/zasoby podmiot udostępnia — najlepiej wprost '
      + 'to, które pokrywa niespełniony warunek udziału (np. „budowa oczyszczalni o '
      + 'przepustowości min. 5000 m³/d, jedna realizacja o wartości 6 mln zł").',
    podstawa: 'art. 118 ust. 4 pkt 1 Pzp — zakres dostępnych zasobów',
    wymagane: true,
    sciezka: ['zakres_doswiadczenia'],
  },
  {
    id: ID_POL.SPOSOB_UDOSTEPNIENIA,
    etykieta: 'Sposób udostępnienia i wykorzystania zasobów',
    opis:
      'W jaki sposób podmiot udostępni i włączy swoje zasoby do realizacji zamówienia '
      + '(przy doświadczeniu w robotach/usługach — przez udział w wykonaniu, zwykle jako '
      + 'podwykonawca, wraz z nadzorem własnej kadry). Blankietowe „udostępniam zasoby" '
      + 'to za mało.',
    podstawa: 'art. 118 ust. 4 pkt 2 Pzp — sposób udostępnienia i wykorzystania zasobów',
    wymagane: true,
    sciezka: ['sposob_udostepnienia'],
  },
  {
    id: ID_POL.OKRES_UDOSTEPNIENIA,
    etykieta: 'Okres udostępnienia zasobów',
    opis:
      'Na jaki czas zasoby są udostępniane — powinien obejmować cały okres realizacji '
      + 'części zamówienia, do której potrzebne jest doświadczenie podmiotu.',
    podstawa: 'art. 118 ust. 4 pkt 2 Pzp — okres udostępnienia zasobów',
    wymagane: true,
    sciezka: ['okres_udostepnienia'],
  },
  {
    id: ID_POL.ZAKRES_PODWYKONAWSTWA,
    etykieta: 'Zakres robót/usług realizowanych przez podmiot (podwykonawstwo)',
    opis:
      'Czy i w jakim zakresie podmiot udostępniający SAM wykona roboty lub usługi, dla '
      + 'których wymagane jest jego doświadczenie. Ten zakres musi pokrywać się z '
      + 'udostępnianym doświadczeniem — inaczej udostępnienie będzie pozorne.',
    podstawa: 'art. 118 ust. 4 pkt 3 w zw. z ust. 2 Pzp — realizacja robót/usług przez podmiot',
    wymagane: true,
    sciezka: ['zakres_podwykonawstwa'],
  },
]);

/**
 * Zwraca pusty draft zobowiązania (mutowalny) ze wszystkimi polami modelu.
 * Kolejne kroki kreatora/UI wypełniają go, a `walidujKompletnoscZobowiazania`
 * sprawdza, czy niczego nie pominięto.
 * @returns {{dane_podmiotu: {nazwa: string, identyfikator: string, adres: string,
 *   reprezentant: string}, zakres_doswiadczenia: string, sposob_udostepnienia: string,
 *   okres_udostepnienia: string, zakres_podwykonawstwa: string}}
 */
export function szablonZobowiazania() {
  return {
    dane_podmiotu: {
      nazwa: '',
      identyfikator: '',
      adres: '',
      reprezentant: '',
    },
    zakres_doswiadczenia: '',
    sposob_udostepnienia: '',
    okres_udostepnienia: '',
    zakres_podwykonawstwa: '',
  };
}

/**
 * @typedef {object} BrakPola
 * @property {string} id id pola z {@link ID_POL}.
 * @property {string} etykieta etykieta pola (do komunikatu w UI).
 * @property {string} sciezka ścieżka pola złączona kropką (np. „dane_podmiotu.nazwa").
 */

/**
 * @typedef {object} OstrzezeniePola
 * @property {string} id id pola z {@link ID_POL}.
 * @property {string} etykieta etykieta pola.
 * @property {string} sciezka ścieżka pola złączona kropką.
 * @property {string} powod dlaczego pole warto uzupełnić.
 */

/**
 * Ocenia KOMPLETNOŚĆ pól zobowiązania: sprawdza obecność (niepustość) każdego
 * pola modelu. Pola wymagane → braki (blokują kompletność); pola zalecane →
 * ostrzeżenia (nie blokują). NIE waliduje formatu ani zgodności prawnej treści.
 * @param {object} zobowiazanie draft zobowiązania (jak z {@link szablonZobowiazania}).
 * @returns {{kompletne: boolean, braki: BrakPola[], ostrzezenia: OstrzezeniePola[],
 *   wypelnione: string[]}} obiekt ZAMROŻONY.
 * @throws {TypeError} gdy `zobowiazanie` nie jest zwykłym obiektem.
 */
export function walidujKompletnoscZobowiazania(zobowiazanie) {
  if (zobowiazanie === null || typeof zobowiazanie !== 'object' || Array.isArray(zobowiazanie)) {
    throw new TypeError('walidujKompletnoscZobowiazania: zobowiazanie musi być obiektem');
  }

  const braki = [];
  const ostrzezenia = [];
  const wypelnione = [];

  for (const pole of POLA_ZOBOWIAZANIA) {
    const wartosc = odczytajSciezke(zobowiazanie, pole.sciezka);
    const wypelnione_ok = niepustyString(wartosc);
    const sciezka = pole.sciezka.join('.');

    if (pole.wymagane) {
      if (wypelnione_ok) {
        wypelnione.push(pole.id);
      } else {
        braki.push(Object.freeze({ id: pole.id, etykieta: pole.etykieta, sciezka }));
      }
    } else if (!wypelnione_ok) {
      ostrzezenia.push(Object.freeze({
        id: pole.id,
        etykieta: pole.etykieta,
        sciezka,
        powod: pole.zalecenie ?? 'Pole zalecane — warto uzupełnić.',
      }));
    }
  }

  return Object.freeze({
    kompletne: braki.length === 0,
    braki: Object.freeze(braki),
    ostrzezenia: Object.freeze(ostrzezenia),
    wypelnione: Object.freeze(wypelnione),
  });
}

// Podgląd: `node src/lib/zobowiazaniePodmiotu.js --demo`
if (isMainModule(import.meta.url) && process.argv.includes('--demo')) {
  const pusty = walidujKompletnoscZobowiazania(szablonZobowiazania());
  console.log(JSON.stringify({ POLA_ZOBOWIAZANIA, walidacja_pustego: pusty }, null, 2));
}
