import { isMainModule } from './ids.js';

/**
 * TREŚĆ MERYTORYCZNA kreatora „Pożycz doświadczenie" (art. 118 Pzp) —
 * podzadanie 2/12 ulepszenia „Pożycz doświadczenie: kreator polegania na
 * zasobach podmiotu trzeciego".
 *
 * To CZYSTE DANE (stała), bez UI i bez I/O. Wyjaśniają art. 118 Pzp prostym
 * językiem i skupiają się na DWÓCH filarach, które w orzecznictwie KIO/TSUE
 * decydują o tym, czy udostępnienie zasobów jest realne, czy fikcyjne:
 *   1) przy ROBOTACH i USŁUGACH podmiot udostępniający doświadczenie musi
 *      RZECZYWIŚCIE wykonać tę część zamówienia (art. 118 ust. 2 Pzp) —
 *      w praktyce jako podwykonawca; „użyczenie samych referencji" nie wystarcza,
 *   2) doświadczenia NIE WOLNO „sumować" — jest niepodzielne; warunku wymagającego
 *      jednej realizacji o danej skali nie spełni się, składając je z kawałków
 *      (własnych ani cudzych).
 *
 * Świadome decyzje modelu:
 *  • Zakres CELOWO wąski — tylko te dwa filary. Elementy zobowiązania podmiotu
 *    trzeciego, obowiązek złożenia go z ofertą, pułapki KIO i podpowiedzi z sieci
 *    kontaktów to treść KOLEJNYCH podzadań, nie tego modułu.
 *  • Filar realnego udziału dotyczy WYŁĄCZNIE robót budowlanych i usług — bo tak
 *    stanowi art. 118 ust. 2 Pzp; przy dostawach nie ma wymogu wykonania części
 *    zamówienia przez podmiot udostępniający. Dlatego sekcja niesie jawne
 *    pole `dotyczy` = ['roboty budowlane', 'usługi'], żeby UI nie pokazało tej
 *    zasady tam, gdzie nie obowiązuje.
 *  • Struktura jest GŁĘBOKO ZAMROŻONA — to fakt prawny; konsument (UI) ma ją
 *    tylko wyświetlić, nie „poprawiać" po imporcie.
 *  • `sekcje` to TABLICA (nie mapa) o stabilnej kolejności — UI może renderować
 *    krok po kroku; dostęp po id daje `sekcjaWyjasnienia`.
 */

/** Rekurencyjnie zamraża obiekt/tablicę wraz z zagnieżdżeniami. */
function deepFreeze(wartosc) {
  if (wartosc && typeof wartosc === 'object' && !Object.isFrozen(wartosc)) {
    for (const v of Object.values(wartosc)) deepFreeze(v);
    Object.freeze(wartosc);
  }
  return wartosc;
}

/** Stabilne identyfikatory sekcji — punkt zaczepienia dla UI i testów. */
export const ID_SEKCJI = Object.freeze({
  REALNY_UDZIAL: 'realny-udzial-podwykonawca',
  ZAKAZ_SUMOWANIA: 'zakaz-sumowania',
});

/**
 * @typedef {object} SekcjaWyjasnienia
 * @property {string} id stabilny identyfikator (patrz {@link ID_SEKCJI}).
 * @property {string} tytul nagłówek prostym językiem.
 * @property {string} tresc wyjaśnienie prostym językiem.
 * @property {string} wazne jednozdaniowy „wniosek na wynos".
 * @property {string[]} [dotyczy] rodzaje zamówień, których zasada dotyczy
 *   (obecne tylko tam, gdzie zakres ma znaczenie).
 */

/**
 * Pełne wyjaśnienie art. 118 Pzp prostym językiem (dwa filary). Obiekt GŁĘBOKO
 * ZAMROŻONY.
 * @type {{podstawa_prawna: string, naglowek: string, wprowadzenie: string,
 *   sekcje: SekcjaWyjasnienia[], kluczowe_zasady: string[]}}
 */
export const WYJASNIENIE_ART_118 = deepFreeze({
  podstawa_prawna:
    'art. 118 ustawy z 11 września 2019 r. — Prawo zamówień publicznych (Pzp)',
  naglowek: 'Nie odpadasz — ten warunek możesz wykazać doświadczeniem innej firmy',
  wprowadzenie:
    'Nie musisz spełniać warunku „w pojedynkę". Art. 118 Pzp pozwala Ci polegać '
    + 'na zdolnościach technicznych lub zawodowych (w tym na doświadczeniu) innej '
    + 'firmy — podmiotu udostępniającego zasoby — niezależnie od tego, jak się z nią '
    + 'umówisz. Są jednak dwie żelazne zasady, bez których zamawiający i KIO uznają '
    + 'takie „pożyczenie" za fikcję. Poznaj je, zanim przygotujesz zobowiązanie.',
  sekcje: [
    {
      id: ID_SEKCJI.REALNY_UDZIAL,
      tytul: 'Firma, która użycza doświadczenia, musi realnie wykonać tę część',
      tresc:
        'Przy warunkach dotyczących doświadczenia w ROBOTACH BUDOWLANYCH lub '
        + 'USŁUGACH nie wystarczy, że inna firma podpisze papier i „użyczy" Ci swoich '
        + 'referencji. Art. 118 ust. 2 Pzp wymaga, żeby ten podmiot RZECZYWIŚCIE '
        + 'wykonał tę część zamówienia, do której potrzebne jest jego doświadczenie — '
        + 'w praktyce jako Twój podwykonawca. Doświadczenie „w oderwaniu" od udziału '
        + 'w realizacji jest niezbywalne: nie da się go przekazać jak zaświadczenia. '
        + 'Dlatego w zobowiązaniu trzeba wprost wskazać, jaki zakres robót lub usług '
        + 'wykona firma udostępniająca zasoby — inaczej udostępnienie będzie pozorne.',
      wazne:
        'Przy robotach i usługach: kto użycza doświadczenia, ten musi je faktycznie '
        + 'wykonać jako podwykonawca — samo „użyczenie referencji" to za mało.',
      dotyczy: ['roboty budowlane', 'usługi'],
    },
    {
      id: ID_SEKCJI.ZAKAZ_SUMOWANIA,
      tytul: 'Doświadczenia nie wolno „sumować"',
      tresc:
        'Doświadczenia nie wolno „sumować" — nie da się go poskładać z kawałków. Jeśli warunek wymaga jednej '
        + 'realizacji o określonej skali (np. jednej roboty o wartości min. 500 tys. '
        + 'zł), nie spełnisz go, pokazując dwie mniejsze roboty po 250 tys. zł — ani '
        + 'własne, ani cudze — ani „doklejając" połowę swojego doświadczenia do połowy '
        + 'doświadczenia innej firmy. Takie doświadczenie jest niepodzielne: warunek '
        + 'musi być spełniony W CAŁOŚCI przez jeden podmiot — Ciebie albo firmę '
        + 'udostępniającą zasoby. Zasada jest ugruntowana w orzecznictwie (m.in. wyrok '
        + 'TSUE w sprawie Esaprojekt, C-387/14) i pilnowana przez KIO.',
      wazne:
        'Warunek „na jedną realizację" musi w całości pochodzić od jednego podmiotu — '
        + 'sumowanie mniejszych zleceń (własnych lub cudzych) to droga do odrzucenia.',
    },
  ],
  kluczowe_zasady: [
    'Przy robotach i usługach podmiot udostępniający doświadczenie musi realnie '
      + 'wykonać tę część zamówienia — zwykle jako podwykonawca.',
    'Doświadczenia nie wolno sumować: warunek wymagający jednej realizacji o danej '
      + 'skali musi w całości spełnić jeden podmiot.',
    'Samo „użyczenie referencji" bez udziału w realizacji zamawiający i KIO uznają '
      + 'za udostępnienie pozorne (fikcyjne).',
  ],
});

/**
 * Zwraca sekcję wyjaśnienia po jej stabilnym id.
 * @param {string} id identyfikator z {@link ID_SEKCJI}.
 * @returns {SekcjaWyjasnienia} zamrożona sekcja.
 * @throws {RangeError} gdy id nie pasuje do żadnej sekcji.
 */
export function sekcjaWyjasnienia(id) {
  const sekcja = WYJASNIENIE_ART_118.sekcje.find((s) => s.id === id);
  if (!sekcja) {
    throw new RangeError(`sekcjaWyjasnienia: nieznane id sekcji „${id}"`);
  }
  return sekcja;
}

// Podgląd: `node src/lib/kreator118Tresc.js --demo`
if (isMainModule(import.meta.url) && process.argv.includes('--demo')) {
  console.log(JSON.stringify(WYJASNIENIE_ART_118, null, 2));
}
