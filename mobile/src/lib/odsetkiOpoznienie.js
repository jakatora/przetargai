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

/** Komunikaty walidacji — jawne, po polsku, spójne z kalkulatorem ceny. */
const KOMUNIKAT_KWOTA_NIE_LICZBA = 'Podaj kwotę jako liczbę, np. 1200,00';
const KOMUNIKAT_KWOTA_UJEMNA = 'Kwota nie może być ujemna';
const KOMUNIKAT_PROCENT_NIE_LICZBA = 'Podaj procent jako liczbę, np. 10';
const KOMUNIKAT_STAWKA_ZAKRES = 'Stawka spoza zakresu 0–100%';

/**
 * Klasyfikuje pojedyncze pole liczbowe po wstępnym oczyszczeniu (jak ekran:
 * cyfry/przecinek/kropka/spacja, tu dodatkowo minus dla wykrycia ujemnych).
 * @returns {{pusty: boolean, liczba: number|null}} liczba=null gdy tekst nie jest liczbą.
 */
function analizujPole(x) {
  const oczyszczone = String(x ?? '').replace(/[^0-9.,\- ]/g, '');
  const bezSpacji = oczyszczone.replace(/\s/g, '').replace(/,/g, '.');
  if (bezSpacji === '') return { pusty: true, liczba: null };
  const n = Number(bezSpacji);
  return { pusty: false, liczba: Number.isFinite(n) ? n : null };
}

/**
 * Waliduje wejście kalkulatora odsetek — zamiast cicho zerować błędne pola,
 * zwraca jawne komunikaty PL pod każde pole. Puste pole = brak błędu (stan pusty).
 * Nie dotyczy dat — te obsługuje `bladDaty` z `policzOdsetki`.
 * @param {{kwota?, stawkaRoczna?}} we
 * @returns {{bledy: {[pole:string]: string}, maBledy: boolean}}
 */
export function walidujOdsetki({ kwota, stawkaRoczna } = {}) {
  const bledy = {};

  const kwotaPole = analizujPole(kwota);
  if (!kwotaPole.pusty) {
    if (kwotaPole.liczba === null) bledy.kwota = KOMUNIKAT_KWOTA_NIE_LICZBA;
    else if (kwotaPole.liczba < 0) bledy.kwota = KOMUNIKAT_KWOTA_UJEMNA;
  }

  const stawkaPole = analizujPole(stawkaRoczna);
  if (!stawkaPole.pusty) {
    if (stawkaPole.liczba === null) bledy.stawkaRoczna = KOMUNIKAT_PROCENT_NIE_LICZBA;
    else if (stawkaPole.liczba < 0 || stawkaPole.liczba > 100) bledy.stawkaRoczna = KOMUNIKAT_STAWKA_ZAKRES;
  }

  return { bledy, maBledy: Object.keys(bledy).length > 0 };
}
