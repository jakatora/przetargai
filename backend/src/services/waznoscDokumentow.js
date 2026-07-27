/**
 * Czysta logika świeżości dokumentów sejfu (ulepszenie „Sejf podmiotowych
 * środków dowodowych z licznikiem świeżości", podzadanie 2/7).
 *
 * Wszystkie funkcje są CZYSTE i NIE zależą od bazy ani od zegara systemowego:
 *  • daty to łańcuchy ISO 'YYYY-MM-DD' (tak trzyma je kolumna `data_wystawienia`),
 *  • „dziś" jest zawsze WSTRZYKIWANE jako `dzienOdniesienia` — dzięki temu ta sama
 *    logika rozstrzyga status zarówno „na dzisiaj" (licznik w sejfie), jak i „na
 *    przewidywany dzień złożenia oferty" (dopasowanie do SWZ, podzadanie 5, gdzie
 *    przesunięcie terminu potrafi przeterminować dokument PRZED złożeniem).
 *
 * Arytmetyka dat idzie po UTC-północy (pełne dni), więc jest odporna na strefę
 * czasową i zmiany czasu (DST). Realny czas oczekiwania na urząd (`czasOczekiwaniaUrzad`)
 * pochodzi z `config/dokumentyKatalog.js` — to on decyduje, JAK WCZEŚNIE alarmować:
 * KRK pocztą (~21 dni) zapala alert istotnie wcześniej niż US/ZUS (~7 dni).
 */

const MS_DZIEN = 24 * 60 * 60 * 1000;

/** Możliwe statusy dokumentu (kontrakt z UI/monitorem). */
export const STATUS = Object.freeze({
  GOTOWY: 'gotowy',
  ZAMOW_NOWY: 'zamow_nowy',
  PRZETERMINOWANY: 'przeterminowany',
});

/**
 * Zamienia datę ISO 'YYYY-MM-DD' na numer dnia liczony od epoki (UTC).
 * Waliduje realność daty (odrzuca np. 30 lutego) — dzień = ms/86_400_000.
 * @param {string} data 'YYYY-MM-DD' (dopuszczalny dłuższy ISO — bierzemy część datową)
 * @returns {number} całkowity numer dnia (dni od 1970-01-01 UTC)
 */
function naNumerDnia(data) {
  if (typeof data !== 'string') {
    throw new TypeError(`Data musi być łańcuchem ISO 'YYYY-MM-DD', otrzymano: ${typeof data}`);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data.trim());
  if (!m) {
    throw new TypeError(`Nieprawidłowy format daty (oczekiwano 'YYYY-MM-DD'): ${data}`);
  }
  const rok = Number(m[1]);
  const mies = Number(m[2]);
  const dzien = Number(m[3]);
  const ms = Date.UTC(rok, mies - 1, dzien);
  const d = new Date(ms);
  // Round-trip: Date.UTC „rolluje" nadmiar (30 lutego → 1/2 marca), więc porównanie
  // składowych wychwytuje daty nieistniejące w kalendarzu.
  if (
    d.getUTCFullYear() !== rok
    || d.getUTCMonth() !== mies - 1
    || d.getUTCDate() !== dzien
  ) {
    throw new RangeError(`Data nie istnieje w kalendarzu: ${data}`);
  }
  return Math.floor(ms / MS_DZIEN);
}

/** Zamienia numer dnia (od epoki, UTC) z powrotem na 'YYYY-MM-DD'. */
function zNumeruDnia(numerDnia) {
  const d = new Date(numerDnia * MS_DZIEN);
  const rok = String(d.getUTCFullYear()).padStart(4, '0');
  const mies = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dzien = String(d.getUTCDate()).padStart(2, '0');
  return `${rok}-${mies}-${dzien}`;
}

/** Waliduje okres ważności: null (bezterminowy) albo nieujemna liczba całkowita dni. */
function sprawdzOkres(okresWaznosciDni) {
  if (okresWaznosciDni === null || okresWaznosciDni === undefined) return null;
  if (!Number.isInteger(okresWaznosciDni) || okresWaznosciDni < 0) {
    throw new RangeError(
      `okresWaznosciDni musi być null (bezterminowy) albo nieujemną liczbą całkowitą, otrzymano: ${okresWaznosciDni}`,
    );
  }
  return okresWaznosciDni;
}

/**
 * Data ważności dokumentu = data wystawienia + okres ważności.
 * @param {string} dataWystawienia 'YYYY-MM-DD'
 * @param {number|null} okresWaznosciDni liczba dni ważności; null = bezterminowy
 * @returns {string|null} 'YYYY-MM-DD' albo null dla dokumentu bezterminowego
 */
export function dataWaznosci(dataWystawienia, okresWaznosciDni) {
  const okres = sprawdzOkres(okresWaznosciDni);
  if (okres === null) return null;
  return zNumeruDnia(naNumerDnia(dataWystawienia) + okres);
}

/**
 * Ile dni zostało do utraty ważności względem dnia odniesienia.
 *  > 0  — zapas (dokument świeży),
 *  = 0  — ostatni ważny dzień,
 *  < 0  — dokument już przeterminowany (o tyle dni),
 *  Infinity — dokument bezterminowy (nigdy nie traci ważności).
 * @param {string} dataWystawienia 'YYYY-MM-DD'
 * @param {number|null} okresWaznosciDni liczba dni; null = bezterminowy
 * @param {string} dzienOdniesienia 'YYYY-MM-DD' — „dziś" lub przewidywany dzień złożenia
 * @returns {number}
 */
export function dniDoWaznosci(dataWystawienia, okresWaznosciDni, dzienOdniesienia) {
  const okres = sprawdzOkres(okresWaznosciDni);
  const odniesienie = naNumerDnia(dzienOdniesienia); // waliduje datę także dla bezterminowych
  if (okres === null) return Infinity;
  const waznosc = naNumerDnia(dataWystawienia) + okres;
  return waznosc - odniesienie;
}

/**
 * Status dokumentu na wskazany dzień odniesienia:
 *  • 'przeterminowany' — po dniu ważności,
 *  • 'zamow_nowy'      — zapas dni ≤ realny czas urzędu (+bufor), trzeba już zamawiać,
 *  • 'gotowy'          — jest jeszcze czas (albo dokument bezterminowy).
 *
 * Próg „zamów nowy" to dokładnie moment, od którego świeży dokument nie zdąży
 * dojść z urzędu przed wygaśnięciem obecnego (patrz {@link dzienAlertu}).
 *
 * @param {object} p
 * @param {string} p.dataWystawienia 'YYYY-MM-DD'
 * @param {number|null} p.okresWaznosciDni liczba dni; null = bezterminowy
 * @param {number} p.czasOczekiwaniaUrzadDni realny (najgorszy) czas wyrobienia w urzędzie
 * @param {string} p.dzienOdniesienia 'YYYY-MM-DD' — „dziś" lub przewidywany dzień złożenia
 * @param {number} [p.buforDni=0] dodatkowy zapas bezpieczeństwa (alarm jeszcze wcześniej)
 * @returns {'gotowy'|'zamow_nowy'|'przeterminowany'}
 */
export function statusDokumentu({
  dataWystawienia,
  okresWaznosciDni,
  czasOczekiwaniaUrzadDni,
  dzienOdniesienia,
  buforDni = 0,
}) {
  const dni = dniDoWaznosci(dataWystawienia, okresWaznosciDni, dzienOdniesienia);
  if (dni === Infinity) return STATUS.GOTOWY; // bezterminowy — licznik świeżości go nie tyka
  if (dni < 0) return STATUS.PRZETERMINOWANY;
  const prog = czasOczekiwaniaUrzadDni + buforDni;
  return dni <= prog ? STATUS.ZAMOW_NOWY : STATUS.GOTOWY;
}

/**
 * Dzień, od którego trzeba zacząć alarmować „zamów nowy", żeby świeży dokument
 * zdążył dojść z urzędu przed wygaśnięciem obecnego:
 *   dzień alertu = data ważności − (czas oczekiwania urzędu + bufor).
 * Dla KRK (czas ~21 dni) wypada to najwcześniej ze wszystkich typów.
 * @param {string|null} dataWaznosciISO 'YYYY-MM-DD' albo null (bezterminowy → brak alertu)
 * @param {number} czasOczekiwaniaUrzad realny czas wyrobienia w urzędzie (dni)
 * @param {number} [buforDni=0] dodatkowy zapas bezpieczeństwa
 * @returns {string|null} 'YYYY-MM-DD' albo null
 */
export function dzienAlertu(dataWaznosciISO, czasOczekiwaniaUrzad, buforDni = 0) {
  if (dataWaznosciISO === null || dataWaznosciISO === undefined) return null;
  if (!Number.isInteger(czasOczekiwaniaUrzad) || czasOczekiwaniaUrzad < 0) {
    throw new RangeError(
      `czasOczekiwaniaUrzad musi być nieujemną liczbą całkowitą, otrzymano: ${czasOczekiwaniaUrzad}`,
    );
  }
  if (!Number.isInteger(buforDni) || buforDni < 0) {
    throw new RangeError(`buforDni musi być nieujemną liczbą całkowitą, otrzymano: ${buforDni}`);
  }
  return zNumeruDnia(naNumerDnia(dataWaznosciISO) - (czasOczekiwaniaUrzad + buforDni));
}
