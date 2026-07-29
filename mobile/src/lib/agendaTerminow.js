/**
 * Agenda terminów — układa ZAPISANE przetargi w chronologiczną oś „co i kiedy mnie czeka".
 *
 * Czysta funkcja (czas wstrzykiwany) — całe UI tylko renderuje wynik. Klasyfikację czasu
 * bierze z przetestowanego `opisTerminu` (lib/termin.js), więc etykiety i pilność są
 * spójne z kartami przetargu; tu dokładamy tylko sortowanie i grupowanie.
 */

import { opisTerminu } from './termin.js';

/** Grupy w stałej kolejności prezentacji (najpilniejsze u góry, po terminie osobno). */
export const GRUPY_AGENDY = [
  { klucz: 'poTerminie', etykieta: 'Po terminie' },
  { klucz: 'dzis', etykieta: 'Dziś i jutro' },
  { klucz: 'tydzien', etykieta: 'W tym tygodniu' },
  { klucz: 'pozniej', etykieta: 'Później' },
];

// Mapowanie stanu z opisTerminu na grupę agendy.
const GRUPA_ZE_STANU = {
  minal: 'poTerminie',
  dzis: 'dzis',
  jutro: 'dzis',
  wkrotce: 'tydzien',
  odlegly: 'pozniej',
};

/**
 * @param {Array<{id: string, tender: {id: string, deadline?: string, title?: string, organization?: string}}>} zapisane
 *   lista z `api.getSaved()` (pole `saved`).
 * @param {number} [teraz] czas odniesienia w ms — wstrzykiwany w testach.
 * @returns {{grupy: Array<{klucz: string, etykieta: string, pozycje: object[]}>, licznik: number}}
 *   grupy niepuste w stałej kolejności; `licznik` = liczba przetargów z realnym terminem.
 */
export function zbudujAgende(zapisane, teraz = Date.now()) {
  const pozycje = (Array.isArray(zapisane) ? zapisane : [])
    .map((it) => {
      const deadline = it?.tender?.deadline ?? null;
      const t = opisTerminu(deadline, teraz);
      return { it, deadline, t };
    })
    // Tylko przetargi z realnym terminem — bez terminu nie ma czego układać na osi.
    .filter((x) => x.deadline && x.t.stan !== 'brak')
    .map((x) => ({
      id: x.it.id,
      tenderId: x.it.tender.id,
      tytul: x.it.tender.title ?? '(bez tytułu)',
      organizacja: x.it.tender.organization ?? null,
      deadline: x.deadline,
      czasMs: new Date(x.deadline).getTime(),
      etykietaCzasu: x.t.etykieta,
      pilny: x.t.pilny,
      minal: x.t.minal,
      grupa: GRUPA_ZE_STANU[x.t.stan] ?? 'pozniej',
      zrodlo: x.it, // pełny wpis — ekran nawiguje do MatchDetail z { match: zrodlo }
    }))
    // Chronologicznie: najbliższy termin u góry.
    .sort((a, b) => a.czasMs - b.czasMs);

  const grupy = GRUPY_AGENDY
    .map((g) => ({ ...g, pozycje: pozycje.filter((p) => p.grupa === g.klucz) }))
    .filter((g) => g.pozycje.length);

  return { grupy, licznik: pozycje.length };
}
