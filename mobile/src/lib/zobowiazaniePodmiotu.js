/**
 * MODEL „zobowiązanie podmiotu udostępniającego zasoby" (art. 118 ust. 4 Pzp) +
 * walidacja kompletności — strona mobilna. Podzadanie 6/12 ulepszenia „Pożycz
 * doświadczenie: kreator polegania na zasobach podmiotu trzeciego".
 *
 * Dwie warstwy w jednym pliku:
 *   1) LUSTRO backendowego modelu `backend/src/lib/zobowiazaniePodmiotu.js`
 *      (ID_POL, POLA_ZOBOWIAZANIA, szablonZobowiazania, walidujKompletnoscZobowiazania).
 *      Mobile to osobny pakiet Expo i NIE importuje backendu, więc model jest tu
 *      skopiowany 1:1, a test (`test/zobowiazaniePodmiotu.test.js`) pilnuje tego
 *      samego kontraktu co po stronie backendu — gdyby wersje się rozjechały,
 *      złapie to test, nie użytkownik.
 *   2) WSPARCIE FORMULARZA (tylko mobile) — czyste helpery, których potrzebuje
 *      ekran kroku 2 (`KrokDanePodmiotuScreen`), żeby zostać cienkim renderem:
 *      `grupujPolaFormularza` (dwie sekcje formularza) i `ustawWartoscPola`
 *      (niemutujący zapis po ścieżce). Logika testowalna bez renderera; ekran
 *      tylko ją spina z polami tekstowymi (jak `RegisterScreen`).
 *
 * Świadome decyzje (zgodne z backendem):
 *  • „Kompletność" = OBECNOŚĆ merytorycznej treści pola (niepusty string), NIE
 *    poprawność formatu (np. NIP) ani zgodność prawna — to zadanie osobnych kroków.
 *  • `zakres_podwykonawstwa` (art. 118 ust. 4 pkt 3) jest WYMAGANY: kreator dotyczy
 *    pożyczania DOŚWIADCZENIA przy robotach/usługach, gdzie podmiot musi realnie
 *    wykonać tę część (art. 118 ust. 2). Puste pole = pułapka „użyczenia referencji".
 *  • Nazwa i identyfikator podmiotu są WYMAGANE; adres i reprezentant ZALECANE
 *    (brak → ostrzeżenie, nie blokuje kompletności).
 *  • Model DEKLARATYWNY i GŁĘBOKO ZAMROŻONY; wynik walidacji ZAMROŻONY (migawka).
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
 * DEKLARATYWNY model pól zobowiązania. Tablica GŁĘBOKO ZAMROŻONA — walidacja to
 * jeden przebieg po niej, a formularz kroku 2 generuje z niej pola tekstowe.
 * Lustro backendowej stałej `POLA_ZOBOWIAZANIA`.
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
 * Formularz kroku 2 startuje z tego szablonu i wypełnia go, a
 * `walidujKompletnoscZobowiazania` sprawdza, czy niczego nie pominięto.
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
 * Ocenia KOMPLETNOŚĆ pól zobowiązania: sprawdza obecność (niepustość) każdego
 * pola modelu. Pola wymagane → braki (blokują kompletność); pola zalecane →
 * ostrzeżenia (nie blokują). NIE waliduje formatu ani zgodności prawnej treści.
 * @param {object} zobowiazanie draft zobowiązania (jak z {@link szablonZobowiazania}).
 * @returns {{kompletne: boolean, braki: object[], ostrzezenia: object[],
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

// ── wsparcie formularza (tylko mobile) ───────────────────────────────────────

/** Stabilne id sekcji formularza — dwie grupy pól w kroku 2 kreatora. */
export const ID_SEKCJI_FORMULARZA = Object.freeze({
  DANE_PODMIOTU: 'dane-podmiotu',
  ZAKRES_UDOSTEPNIENIA: 'zakres-udostepnienia',
});

/** Definicje sekcji: id → nagłówek + który segment ścieżki tu należy. */
const SEKCJE_DEF = deepFreeze([
  {
    id: ID_SEKCJI_FORMULARZA.DANE_PODMIOTU,
    tytul: 'Dane podmiotu udostępniającego zasoby',
    opis: 'Kogo zobowiązanie dotyczy — kto użycza doświadczenia i podpisze dokument.',
    korzenSciezki: 'dane_podmiotu',
  },
  {
    id: ID_SEKCJI_FORMULARZA.ZAKRES_UDOSTEPNIENIA,
    tytul: 'Zakres i warunki udostępnienia',
    opis: 'Cztery elementy wymagane przez art. 118 ust. 4 Pzp — bez nich udostępnienie jest pozorne.',
    korzenSciezki: null,
  },
]);

/**
 * Grupuje pola modelu w dwie sekcje formularza (dane podmiotu vs. zakres i
 * warunki udostępnienia), zachowując kolejność z {@link POLA_ZOBOWIAZANIA}.
 * Ekran renderuje z tego dwa bloki pól — nie zna reguł podziału.
 * @returns {{id: string, tytul: string, opis: string, pola: object[]}[]}
 */
export function grupujPolaFormularza() {
  return SEKCJE_DEF.map((sekcja) => ({
    id: sekcja.id,
    tytul: sekcja.tytul,
    opis: sekcja.opis,
    pola: POLA_ZOBOWIAZANIA.filter((pole) =>
      sekcja.korzenSciezki === null
        ? pole.sciezka.length === 1
        : pole.sciezka[0] === sekcja.korzenSciezki),
  }));
}

/**
 * Niemutujący zapis wartości pod ścieżką — zwraca NOWY obiekt (klonuje tylko
 * gałąź do zmienianego pola). Formularz kroku 2 używa go w `onChangeText`,
 * żeby aktualizować draft zobowiązania bez mutowania stanu Reacta.
 * @param {object} obiekt aktualny draft (lub jego zagnieżdżenie).
 * @param {string[]} sciezka np. ['dane_podmiotu','nazwa'].
 * @param {*} wartosc nowa wartość liścia.
 * @returns {object} nowy obiekt z podmienioną wartością.
 * @throws {TypeError} gdy `sciezka` nie jest niepustą tablicą.
 */
export function ustawWartoscPola(obiekt, sciezka, wartosc) {
  if (!Array.isArray(sciezka) || sciezka.length === 0) {
    throw new TypeError('ustawWartoscPola: sciezka musi być niepustą tablicą');
  }
  const baza = (obiekt !== null && typeof obiekt === 'object' && !Array.isArray(obiekt)) ? obiekt : {};
  const [glowa, ...ogon] = sciezka;
  if (ogon.length === 0) {
    return { ...baza, [glowa]: wartosc };
  }
  return { ...baza, [glowa]: ustawWartoscPola(baza[glowa], ogon, wartosc) };
}
