/**
 * Pulpit „Moje postępowania" — widok ETAPOWY zapisanych przetargów (rozważam → przygotowuję
 * → złożona → wygrana → przegrana). Domyka triadę feed → kalendarz → pulpit: jednym rzutem oka
 * widać, ile ofert jest na jakim etapie i co pilne. Czysta funkcja (czas wstrzykiwany).
 */

import { STATUSY, STATUS_DOMYSLNY } from './statusPrzetargu.js';
import { opisTerminu } from './termin.js';

// Otwarte etapy — tu pilny termin oznacza „wymaga uwagi" (po wygranej/przegranej już nie składasz).
const OTWARTE = new Set(['rozwazam', 'przygotowuje', 'zlozona']);

const czasMs = (deadline) => {
  if (!deadline) return Infinity;
  const t = new Date(deadline).getTime();
  return Number.isNaN(t) ? Infinity : t;
};

/**
 * @param {Array<{id, status?, tender:{title?, organization?, deadline?}}>} zapisane z api.getSaved()
 * @param {number} [teraz] czas odniesienia w ms.
 * @returns {{grupy: Array<{wartosc, etykieta, pozycje: object[], liczba: number}>,
 *   lacznie: number, wymagaUwagi: number}}
 */
export function zbudujPulpit(zapisane, teraz = Date.now()) {
  const items = (Array.isArray(zapisane) ? zapisane : []).map((it) => {
    const status = it?.status || STATUS_DOMYSLNY;
    const deadline = it?.tender?.deadline ?? null;
    const t = opisTerminu(deadline, teraz);
    return {
      id: it.id,
      status,
      tytul: it?.tender?.title ?? '(bez tytułu)',
      organizacja: it?.tender?.organization ?? null,
      deadline,
      etykietaCzasu: t.etykieta,
      pilny: t.pilny,
      minal: t.minal,
      maTermin: t.stan !== 'brak',
      zrodlo: it,
    };
  });

  const grupy = STATUSY
    .map((s) => {
      const pozycje = items
        .filter((i) => i.status === s.wartosc)
        // Najbliższy termin u góry; bez terminu (Infinity) na koniec.
        .sort((a, b) => czasMs(a.deadline) - czasMs(b.deadline));
      return { wartosc: s.wartosc, etykieta: s.etykieta, pozycje, liczba: pozycje.length };
    })
    .filter((g) => g.liczba);

  const wymagaUwagi = items.filter((i) => OTWARTE.has(i.status) && i.pilny && !i.minal).length;

  return { grupy, lacznie: items.length, wymagaUwagi };
}

/**
 * Który stan pokazać na ekranie pulpitu (P1-8). Błąd wczytania bez żadnych danych to
 * OSOBNY stan — nie wolno go pokazać jako „brak postępowań", bo to fałszywa informacja.
 * Gdy lista jest już znana, błąd/odświeżanie jej nie chowa (zostaje ostatni stan).
 * @param {{ladowanie: boolean, blad: boolean, lacznie: number}} s
 * @returns {'ladowanie'|'blad'|'pusty'|'lista'}
 */
export function stanPulpitu({ ladowanie, blad, lacznie }) {
  if (lacznie > 0) return 'lista';
  if (ladowanie) return 'ladowanie';
  if (blad) return 'blad';
  return 'pusty';
}
