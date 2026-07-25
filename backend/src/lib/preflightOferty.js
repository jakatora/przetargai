/**
 * MODEL DANYCH wyniku PRE-FLIGHT kontroli oferty przed wysłaniem (ulepszenie
 * „Pre-flight kontrola oferty przed wysłaniem — podpis + kompletność",
 * podzadanie 1/12).
 *
 * Ten plik zawiera WYŁĄCZNIE kształt wyniku — bez logiki sprawdzeń. Faktyczne
 * detektory (poprawność i typ podpisu, zgodność podpisującego z KRS/CEIDG,
 * komplet załączników z SWZ, spójność formularza z załącznikami, wewnętrzny
 * deadline 24h) dokładają się w kolejnych podzadaniach i produkują właśnie takie
 * `PunktKontroli`, które `raportPreflight` scala w jeden `RaportPreflight`.
 *
 * Świadome decyzje modelu:
 *  • Status punktu jest DWUSTANOWY (zielony/czerwony) — ulepszenie opisuje wynik
 *    jako „prostą listę: zielone/czerwone z instrukcją naprawy". To celowo mniej
 *    niż trójstopniowa skala flag umowy (lib/umowaAnaliza.js): bramka wysyłki ma
 *    dawać jednoznaczne „można / nie można", a nie odcień do interpretacji.
 *  • Status ogólny jest WYPROWADZANY z punktów, nie podawany z zewnątrz — jedno
 *    źródło prawdy, raport nie może twierdzić „pass", gdy ma czerwony punkt.
 *  • pass ⟺ lista NIEPUSTA i wszystkie punkty zielone. PUSTA lista => fail:
 *    brak jakiejkolwiek weryfikacji nie może być zielonym światłem do wysyłki
 *    oferty (fałszywy „pass" przy zerowej kontroli byłby najgroźniejszym błędem
 *    tej bramki). To NIE jest logika sprawdzeń — to reguła agregacji modelu.
 *  • Fabryki zwracają obiekty ZAMROŻONE, a raport trzyma WŁASNĄ kopię listy
 *    punktów — wynik kontroli jest migawką, której nikt nie „poprawi" po fakcie.
 *  • Konstruktory pilnują integralności (dozwolony status, niepuste id/nazwa),
 *    żeby wadliwy punkt nie prześlizgnął się do raportu i UI.
 */

/** Dwustanowy status pojedynczego punktu kontroli. */
export const STATUS = Object.freeze({
  zielony: 'zielony',
  czerwony: 'czerwony',
});

/** Ogólny werdykt całego raportu — bramka „można wysłać / nie można". */
export const WYNIK = Object.freeze({
  pass: 'pass',
  fail: 'fail',
});

const DOZWOLONE_STATUSY = Object.freeze(Object.values(STATUS));

/** Czy wartość jest niepustym (po przycięciu spacji) stringiem. */
function niepustyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Buduje pojedynczy `PunktKontroli` — jeden sprawdzany aspekt oferty.
 * @param {object} arg
 * @param {string} arg.id stabilny identyfikator punktu (np. 'podpis_formularz');
 *   klucz kontraktu dla UI i testów kolejnych podzadań — wymagany, niepusty.
 * @param {string} arg.nazwa etykieta „po ludzku" pokazywana na liście — wymagana.
 * @param {string} arg.status jeden z `STATUS` (zielony/czerwony) — wymagany.
 * @param {string} [arg.komunikat] co wykryto (dlaczego zielono/czerwono).
 * @param {string} [arg.instrukcja_naprawy] konkretny krok naprawczy przy czerwonym.
 * @returns {{id: string, nazwa: string, status: string, komunikat: string, instrukcja_naprawy: string}}
 *   obiekt ZAMROŻONY.
 * @throws {TypeError} gdy id/nazwa puste albo status spoza `STATUS`.
 */
export function punktKontroli({ id, nazwa, status, komunikat = '', instrukcja_naprawy = '' } = {}) {
  if (!niepustyString(id)) {
    throw new TypeError('punktKontroli: id musi być niepustym stringiem');
  }
  if (!niepustyString(nazwa)) {
    throw new TypeError('punktKontroli: nazwa musi być niepustym stringiem');
  }
  if (!DOZWOLONE_STATUSY.includes(status)) {
    throw new TypeError(
      `punktKontroli: status musi być jednym z ${DOZWOLONE_STATUSY.join('/')}, otrzymano: ${status}`,
    );
  }
  return Object.freeze({
    id,
    nazwa,
    status,
    komunikat: String(komunikat ?? ''),
    instrukcja_naprawy: String(instrukcja_naprawy ?? ''),
  });
}

/**
 * Scala listę punktów w `RaportPreflight` z wyprowadzonym statusem ogólnym.
 * @param {Array<ReturnType<typeof punktKontroli>>} punkty punkty kontroli.
 * @returns {{punkty: Array, status: string}} raport ZAMROŻONY z WŁASNĄ kopią
 *   listy punktów; `status` = `WYNIK.pass` tylko gdy lista niepusta i wszystkie
 *   punkty zielone, w przeciwnym razie `WYNIK.fail`.
 * @throws {TypeError} gdy `punkty` nie jest tablicą.
 */
export function raportPreflight(punkty) {
  if (!Array.isArray(punkty)) {
    throw new TypeError('raportPreflight: punkty musi być tablicą');
  }
  const kopia = Object.freeze([...punkty]);
  const pass = kopia.length > 0 && kopia.every((p) => p.status === STATUS.zielony);
  return Object.freeze({
    punkty: kopia,
    status: pass ? WYNIK.pass : WYNIK.fail,
  });
}
