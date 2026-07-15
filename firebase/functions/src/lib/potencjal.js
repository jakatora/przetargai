/**
 * FOMO na Free + potencjał (D-055) — czysta logika komunikatu zachęty.
 *
 * Plan Free pokazuje `limitDzienny` dopasowań na dobę; kolejne kwalifikujące się
 * przetargi czekają na następne dni (nie giną — matching je odracza). Uczciwa
 * zachęta: pokazujemy REALNĄ liczbę dopasowań tygodnia i mówimy, że Standard
 * odblokowuje je od razu. Bez zmyślania kwot — BZP zwykle nie podaje wartości.
 */

export const POCZATEK_TYGODNIA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {{isFree:boolean, dzis:number, wTymTygodniu:number, limitDzienny:number}} dane
 * @returns {{pokaz:boolean, wariant?:string, tytul?:string, opis?:string, w_tym_tygodniu?:number, dzis?:number}}
 */
export function zbudujZachete({ isFree, dzis, wTymTygodniu, limitDzienny }) {
  // Płacący nie potrzebują FOMO — nie naprzykrzamy się.
  if (!isFree) return { pokaz: false };

  const limitOsiagniety = dzis >= limitDzienny;
  // „Dużo w tygodniu" = więcej niż jeden dzienny limit uzbierany przez tydzień.
  const duzoWTygodniu = wTymTygodniu > limitDzienny;

  if (!limitOsiagniety && !duzoWTygodniu) return { pokaz: false };

  const wspolne = { pokaz: true, w_tym_tygodniu: wTymTygodniu, dzis };

  // Osiągnięty limit ma priorytet — to najmocniejszy, najświeższy sygnał.
  if (limitOsiagniety) {
    return {
      ...wspolne,
      wariant: 'limit',
      tytul: `Masz dziś komplet: ${limitDzienny} dopasowań`,
      opis: 'Kolejne pasujące przetargi czekają na następne dni. W planie Standard '
        + 'widzisz wszystkie od razu — bez czekania i limitu.',
    };
  }

  return {
    ...wspolne,
    wariant: 'tydzien',
    tytul: `${wTymTygodniu} dopasowań w tym tygodniu`,
    opis: 'W planie Free pokazujemy 5 dziennie, reszta czeka na kolejne dni. '
      + 'Standard odblokowuje wszystkie od razu.',
  };
}
