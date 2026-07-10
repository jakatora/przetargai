/**
 * Normalizacja znaczników czasu z BZP.
 *
 * Cała baza porównuje daty LEKSYKOGRAFICZNIE (`deadline > now` w zapytaniu Firestore
 * i przy filtrowaniu puli). To poprawne wyłącznie wtedy, gdy każdy znacznik jest
 * w tej samej strefie i formacie. BZP tego nie gwarantuje — zwraca zarówno
 * `...Z`, jak i offsety, i daty bez strefy.
 *
 * Zmierzone kontrprzykłady (teraz = 2026-07-10T12:00:00.000Z):
 *   "2026-07-10T13:30:00+02:00" → realnie 11:30 UTC, termin MINĄŁ,
 *                                 a tekstowo wygląda na przyszły;
 *   "2026-07-10T11:00:00-02:00" → realnie 13:00 UTC, termin OTWARTY,
 *                                 a tekstowo wygląda na miniony.
 *
 * Skutek bez normalizacji: przetargi po terminie zostają w puli i wracają do
 * płatnego AI, a otwarte z ujemnym offsetem z niej wypadają (audyt 2026-07-10).
 */

/** Przesunięcie czasu polskiego względem UTC w danym momencie (1 h zimą, 2 h latem). */
function offsetPolskiMinuty(data) {
  // Odczytujemy tę samą chwilę w strefie Warszawy i porównujemy z UTC.
  const wWarszawie = new Date(data.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
  const wUtc = new Date(data.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((wWarszawie - wUtc) / 60_000);
}

const SAMA_DATA = /^\d{4}-\d{2}-\d{2}$/;
const BEZ_STREFY = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Sprowadza znacznik BZP do kanonicznego ISO w UTC (`...Z`).
 *
 * @param {string|null|undefined} surowy
 * @returns {string|null} `null`, gdy brak wartości albo nie da się jej odczytać
 *   (przetarg bez terminu jest normalny — nie wolno go przez to zgubić)
 */
export function doUtcIso(surowy) {
  if (!surowy || typeof surowy !== 'string') return null;
  const tekst = surowy.trim();
  if (!tekst) return null;

  // „Termin: 20 lipca" znaczy „do końca 20 lipca", nie „o północy tego dnia".
  if (SAMA_DATA.test(tekst)) {
    const koniecDniaUtc = new Date(`${tekst}T23:59:59.999Z`);
    const offset = offsetPolskiMinuty(koniecDniaUtc);
    return new Date(koniecDniaUtc.getTime() - offset * 60_000).toISOString();
  }

  /*
   * Data bez strefy pochodzi z polskiego systemu i oznacza czas POLSKI.
   * Potraktowanie jej jako UTC przesunęłoby termin o 1–2 godziny w przyszłość —
   * pokazywalibyśmy przetarg jeszcze po zamknięciu składania ofert.
   */
  if (BEZ_STREFY.test(tekst)) {
    const jakUtc = new Date(`${tekst.replace(' ', 'T')}Z`);
    if (Number.isNaN(jakUtc.getTime())) return null;
    const offset = offsetPolskiMinuty(jakUtc);
    return new Date(jakUtc.getTime() - offset * 60_000).toISOString();
  }

  // Znacznik ze strefą (`Z` albo offset) — `Date` przeliczy go poprawnie.
  const data = new Date(tekst);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}
