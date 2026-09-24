/**
 * Akumulator pomiarów jednego źródła ogłoszeń.
 *
 * Audyt 2026-09-23 nie potrafił zrekonsyliować liczby ogłoszeń w bazie z liczbą
 * po stronie źródła, bo cykl raportował wyłącznie `fetched` (już po deduplikacji)
 * i `skipped` (wyłącznie błędy zapisu). Nie dało się odpowiedzieć, czy brakujące
 * ogłoszenia odpadły na normalizacji, na deduplikacji, czy w ogóle nie zostały
 * pobrane. Adapter dostaje ten obiekt i dopisuje do niego surowe fakty:
 *
 *  • `surowe`    — ile rekordów oddało API (wszystkie zapytania okna razem),
 *  • `odrzucone` — ile odpadło na normalizacji (brak identyfikatora, brak tytułu),
 *  • `zapytania` — ile żądań HTTP kosztowało okno (koszt strategii docinania).
 *
 * Liczniki są ADDYTYWNE — ten sam obiekt przechodzi przez wszystkie zapytania
 * okna, więc mierzy okno, nie pojedyncze żądanie.
 */
export function pustyLicznik() {
  return { surowe: 0, odrzucone: 0, zapytania: 0 };
}

/**
 * Ile rekordów scaliła deduplikacja.
 *
 * Przy BZP to jednocześnie miara kosztu docinania doby po województwach: każde
 * z 16 zapytań zwraca też ogłoszenia widziane już w zapytaniu bez filtra.
 *
 * @param {{surowe: number, odrzucone: number}} licznik
 * @param {number} unikalne ile ogłoszeń zostało po deduplikacji
 */
export function zliczDuplikaty(licznik, unikalne) {
  return Math.max(0, (licznik?.surowe ?? 0) - (licznik?.odrzucone ?? 0) - unikalne);
}
