/**
 * TREŚĆ MERYTORYCZNA kroku 1 kreatora „Pożycz doświadczenie" (art. 118 Pzp) —
 * strona mobilna. Podzadanie 5/12 ulepszenia „Pożycz doświadczenie: kreator
 * polegania na zasobach podmiotu trzeciego".
 *
 * To CZYSTE DANE (stała) + akcesor, bez UI i bez I/O — ekran `Kreator118Screen`
 * jest tylko ich cienkim renderem (jak `flagiUmowy.js` dla prześwietlenia umowy).
 * Trzymamy treść lokalnie w aplikacji, a nie za wywołaniem API, bo to STATYCZNY
 * fakt prawny (nie zależy od danych użytkownika) — dokładnie jak katalog CPV
 * (`cpvKatalog.js`). Wyjaśnia art. 118 Pzp prostym językiem i skupia się na DWÓCH
 * filarach, które w orzecznictwie KIO/TSUE decydują, czy udostępnienie zasobów
 * jest realne, czy fikcyjne:
 *   1) przy ROBOTACH i USŁUGACH podmiot udostępniający doświadczenie musi
 *      RZECZYWIŚCIE wykonać tę część zamówienia (art. 118 ust. 2 Pzp) —
 *      w praktyce jako podwykonawca; „użyczenie samych referencji" nie wystarcza,
 *   2) doświadczenia NIE WOLNO „sumować" — jest niepodzielne.
 *
 * PARYTET: treść jest lustrem backendowego `backend/src/lib/kreator118Tresc.js`
 * (stała `WYJASNIENIE_ART_118`). Mobile to osobny pakiet Expo i nie importuje
 * backendu, więc treść jest tu skopiowana, a test (`test/kreator118Tresc.test.js`)
 * pilnuje kluczowych niezmienników (id sekcji, zakres `dotyczy`, kompletność) —
 * gdyby wersje się rozjechały, złapie to test, nie użytkownik.
 *
 * Świadome decyzje:
 *  • Zakres kroku 1 CELOWO wąski — same zasady (dwa filary). Pułapki fikcyjności,
 *    generowanie zobowiązania i podpowiedzi z sieci kontaktów to KOLEJNE kroki
 *    kreatora (osobne ekrany), nie ten moduł.
 *  • Filar realnego udziału dotyczy WYŁĄCZNIE robót budowlanych i usług (tak
 *    stanowi art. 118 ust. 2 Pzp) — stąd jawne pole `dotyczy`, żeby ekran nie
 *    pokazał tej zasady tam, gdzie nie obowiązuje (przy dostawach).
 *  • Struktura jest GŁĘBOKO ZAMROŻONA — to fakt prawny; ekran ma ją wyświetlić,
 *    nie „poprawiać" po imporcie.
 *  • `sekcje` to TABLICA o stabilnej kolejności (render krok po kroku); dostęp po
 *    id daje `sekcjaWyjasnienia`.
 */

/** Rekurencyjnie zamraża obiekt/tablicę wraz z zagnieżdżeniami. */
function deepFreeze(wartosc) {
  if (wartosc && typeof wartosc === 'object' && !Object.isFrozen(wartosc)) {
    for (const v of Object.values(wartosc)) deepFreeze(v);
    Object.freeze(wartosc);
  }
  return wartosc;
}

/** Stabilne identyfikatory sekcji — parytet z backendem, punkt zaczepienia dla testów. */
export const ID_SEKCJI = Object.freeze({
  REALNY_UDZIAL: 'realny-udzial-podwykonawca',
  ZAKAZ_SUMOWANIA: 'zakaz-sumowania',
});

/**
 * Pełne wyjaśnienie art. 118 Pzp prostym językiem (dwa filary). Obiekt GŁĘBOKO
 * ZAMROŻONY. Lustro backendowej stałej `WYJASNIENIE_ART_118`.
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
 * @returns {object} zamrożona sekcja.
 * @throws {RangeError} gdy id nie pasuje do żadnej sekcji.
 */
export function sekcjaWyjasnienia(id) {
  const sekcja = WYJASNIENIE_ART_118.sekcje.find((s) => s.id === id);
  if (!sekcja) {
    throw new RangeError(`sekcjaWyjasnienia: nieznane id sekcji „${id}"`);
  }
  return sekcja;
}
