import { opisTerminu } from './termin.js';

/**
 * Filtr feedu wg statusu terminu składania: „aktywne" (domyślnie — chowa przeterminowane)
 * albo „po terminie" (tylko te, którym termin minął). To lekka „zakładka" w feedzie —
 * odchudza główną listę, a przeterminowane przetargi zostają dostępne pod jednym kliknięciem.
 *
 * Czysta logika (czas wstrzykiwany do `opisTerminu`), reużywa istniejącej reguły `minal`.
 * Przetargi bez terminu traktujemy jak AKTYWNE (nie „po terminie") — nie znamy daty, więc
 * nie chowamy ich do archiwum.
 */

export const STATUSY_TERMINU = [
  { wartosc: 'aktywne', etykieta: 'Aktywne' },
  { wartosc: 'poterminie', etykieta: 'Po terminie' },
];
export const STATUS_TERMINU_DOMYSLNY = 'aktywne';
export const KLUCZ_STATUS_TERMINU = 'przetargai.feed_status_terminu';

/** Normalizuje zapisany status do znanej wartości (bezpieczne po odczycie ze storage). */
export function normalizujStatusTerminu(w) {
  return STATUSY_TERMINU.some((s) => s.wartosc === w) ? w : STATUS_TERMINU_DOMYSLNY;
}

/** Czy przetarg jest po terminie składania. */
export function czyPoTerminie(tender, teraz = Date.now()) {
  return opisTerminu(tender?.deadline, teraz).minal === true;
}

/**
 * Filtruje dopasowania wg statusu terminu.
 * @param {Array} matches
 * @param {'aktywne'|'poterminie'} status
 * @param {number} [teraz] czas bieżący (ms) — wstrzykiwalny do testów
 */
export function filtrujStatusTerminu(matches, status, teraz = Date.now()) {
  const lista = Array.isArray(matches) ? matches : [];
  if (status === 'poterminie') return lista.filter((m) => czyPoTerminie(m?.tender, teraz));
  return lista.filter((m) => !czyPoTerminie(m?.tender, teraz));
}

/** Ile dopasowań jest po terminie (do licznika na zakładce). */
export function policzPoTerminie(matches, teraz = Date.now()) {
  return (Array.isArray(matches) ? matches : []).reduce(
    (n, m) => (czyPoTerminie(m?.tender, teraz) ? n + 1 : n),
    0,
  );
}
