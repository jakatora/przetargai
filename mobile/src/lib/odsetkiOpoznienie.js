/**
 * Kalkulator odsetek za opóźnienie w płatności + rekompensata. Gdy zamawiający płaci po
 * terminie, wykonawcy należą się odsetki ustawowe za opóźnienie w transakcjach handlowych
 * ORAZ stała rekompensata za koszty odzyskiwania należności (art. 10 ustawy o
 * przeciwdziałaniu nadmiernym opóźnieniom w transakcjach handlowych):
 *   • 40 euro  — świadczenie nie przekracza 5 000 zł (≤ 5 000 zł)
 *   • 70 euro  — świadczenie wyższe niż 5 000 zł, ale niższe niż 50 000 zł
 *   • 100 euro — świadczenie równe lub wyższe od 50 000 zł
 *
 * Odsetki = kwota × stawka_roczna% × dni_opóźnienia / 365. Stawka jest zmienna (obwieszczenie
 * MRPiT), więc podaje ją użytkownik — nie zgadujemy aktualnej wartości. Daty liczone w UTC
 * (dni kalendarzowe) współdzielonym silnikiem z terminKio.js. Termin płatności przypadający
 * na sobotę/dzień ustawowo wolny upływa w najbliższy dzień roboczy (art. 115 KC).
 */

import { naDzienUTC, MS_DZIEN, czyDzienWolny, formatujDate } from './terminKio.js';
import { formatujPLN } from './kalkulatorCeny.js';
import { iloczynDoGroszy } from './grosze.js';
import { bladKwoty, bladProcentu, zbierzBledy } from './walidacjaLiczb.js';

export { formatujPLN };

function num(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Kwota rekompensaty w EUR wg progu należności (art. 10 ust. 1). Próg 5 000 zł jest
 * WŁĄCZNIE po stronie 40 € („nie przekracza 5000 złotych") — poprawka 2026-09-25, wcześniej
 * dokładnie 5 000 zł dawało 70 €.
 */
export function rekompensataEUR(kwota) {
  const k = num(kwota);
  if (k <= 5000) return 40;
  if (k < 50000) return 70;
  return 100;
}

/**
 * @param {{kwota?, terminPlatnosci?, dataZaplaty?, stawkaRoczna?}} we
 *   `terminPlatnosci`/`dataZaplaty` jako ISO `RRRR-MM-DD`. Zapłata w terminie → 0 dni.
 *   Termin w dzień wolny przesuwamy na najbliższy dzień roboczy (art. 115 KC).
 * @returns {{dniOpoznienia: number, odsetki: number, rekompensataEUR: number|null,
 *   terminPrzesunietyNa: string|null, maDane: boolean, bladDaty: boolean}}
 *   `rekompensataEUR` tylko przy opóźnieniu (≥ 1 dzień); `terminPrzesunietyNa` — data
 *   `RRRR-MM-DD`, gdy termin wypadł w dzień wolny, inaczej null.
 */
export function policzOdsetki({ kwota, terminPlatnosci, dataZaplaty, stawkaRoczna } = {}) {
  const k = num(kwota);
  const terminPierwotnyMs = naDzienUTC(terminPlatnosci);
  const zaplataMs = naDzienUTC(dataZaplaty);
  const bladDaty = (terminPlatnosci && terminPierwotnyMs === null) || (dataZaplaty && zaplataMs === null);

  // art. 115 KC (poprawka 2026-09-25): termin w sobotę/święto upływa w najbliższy dzień
  // roboczy — dotąd zapłata w poniedziałek po sobotnim terminie liczyła 2 dni opóźnienia i 40 €.
  let terminMs = terminPierwotnyMs;
  if (terminMs !== null) {
    while (czyDzienWolny(terminMs)) terminMs += MS_DZIEN;
  }
  const terminPrzesunietyNa = terminMs !== null && terminMs !== terminPierwotnyMs ? formatujDate(terminMs) : null;

  let dniOpoznienia = 0;
  if (terminMs !== null && zaplataMs !== null) {
    dniOpoznienia = Math.max(0, Math.round((zaplataMs - terminMs) / MS_DZIEN));
  }

  // kwota × stawka% × dni / 365 liczone DOKŁADNIE (wspólny grosze.js, 2026-09-25) — `Math.round`
  // na floacie gubił połówkę grosza (20 805 zł × 11,75% × 30 dni: 200,92 zamiast 200,93).
  const odsetki = iloczynDoGroszy([k, num(stawkaRoczna), dniOpoznienia], 36500);

  return {
    dniOpoznienia,
    odsetki,
    // Rekompensata należy się dopiero, gdy są odsetki za opóźnienie (art. 10 ust. 1) —
    // zapłata w (przesuniętym) terminie → brak rekompensaty.
    rekompensataEUR: k > 0 && dniOpoznienia > 0 ? rekompensataEUR(k) : null,
    terminPrzesunietyNa,
    maDane: k > 0 && terminMs !== null && zaplataMs !== null,
    bladDaty: Boolean(bladDaty),
  };
}

/**
 * Waliduje wejście kalkulatora odsetek — zamiast cicho zerować błędne pola,
 * zwraca jawne komunikaty PL pod każde pole. Puste pole = brak błędu (stan pusty).
 * Nie dotyczy dat — te obsługuje `bladDaty` z `policzOdsetki`.
 * @param {{kwota?, stawkaRoczna?}} we
 * @returns {{bledy: {[pole:string]: string}, maBledy: boolean}}
 */
export function walidujOdsetki({ kwota, stawkaRoczna } = {}) {
  return zbierzBledy({
    kwota: bladKwoty(kwota),
    stawkaRoczna: bladProcentu(stawkaRoczna, { max: 100, etykieta: 'Stawka' }),
  });
}
