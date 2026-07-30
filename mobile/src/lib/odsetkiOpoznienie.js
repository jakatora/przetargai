/**
 * Kalkulator odsetek za opóźnienie w płatności + rekompensata. Gdy zamawiający płaci po
 * terminie, wykonawcy należą się odsetki ustawowe za opóźnienie w transakcjach handlowych
 * ORAZ stała rekompensata za koszty odzyskiwania należności (art. 10 ustawy o
 * przeciwdziałaniu nadmiernym opóźnieniom w transakcjach handlowych):
 *   • 40 euro  — świadczenie < 5 000 zł
 *   • 70 euro  — świadczenie 5 000 zł do < 50 000 zł
 *   • 100 euro — świadczenie ≥ 50 000 zł
 *
 * Odsetki = kwota × stawka_roczna% × dni_opóźnienia / 365. Stawka jest zmienna (obwieszczenie
 * MRPiT), więc podaje ją użytkownik — nie zgadujemy aktualnej wartości. Daty liczone w UTC
 * (dni kalendarzowe) współdzielonym silnikiem z terminKio.js.
 */

import { naDzienUTC, MS_DZIEN } from './terminKio.js';
import { formatujPLN } from './kalkulatorCeny.js';

export { formatujPLN };

function num(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
const grosze = (n) => Math.round(n * 100) / 100;

/** Kwota rekompensaty w EUR wg progu należności (art. 10 ust. 1). */
export function rekompensataEUR(kwota) {
  const k = num(kwota);
  if (k < 5000) return 40;
  if (k < 50000) return 70;
  return 100;
}

/**
 * @param {{kwota?, terminPlatnosci?, dataZaplaty?, stawkaRoczna?}} we
 *   `terminPlatnosci`/`dataZaplaty` jako ISO `RRRR-MM-DD`. Zapłata w terminie → 0 dni.
 * @returns {{dniOpoznienia: number, odsetki: number, rekompensataEUR: number|null,
 *   maDane: boolean, bladDaty: boolean}}
 */
export function policzOdsetki({ kwota, terminPlatnosci, dataZaplaty, stawkaRoczna } = {}) {
  const k = num(kwota);
  const terminMs = naDzienUTC(terminPlatnosci);
  const zaplataMs = naDzienUTC(dataZaplaty);
  const bladDaty = (terminPlatnosci && terminMs === null) || (dataZaplaty && zaplataMs === null);

  let dniOpoznienia = 0;
  if (terminMs !== null && zaplataMs !== null) {
    dniOpoznienia = Math.max(0, Math.round((zaplataMs - terminMs) / MS_DZIEN));
  }

  const odsetki = grosze(k * (num(stawkaRoczna) / 100) * (dniOpoznienia / 365));

  return {
    dniOpoznienia,
    odsetki,
    rekompensataEUR: k > 0 ? rekompensataEUR(k) : null,
    maDane: k > 0 && terminMs !== null && zaplataMs !== null,
    bladDaty: Boolean(bladDaty),
  };
}
