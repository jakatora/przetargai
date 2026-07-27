/**
 * „STRAŻNIK TERMINU ZWIĄZANIA OFERTĄ" — czysta logika (testowalna `node:test`).
 *
 * PROBLEM: postępowanie się przeciąga, zbliża się koniec terminu związania ofertą; zamawiający
 * przysyła wezwanie do wyrażenia zgody na przedłużenie — przegapione pismo albo wygasłe wadium
 * = wypadnięcie z gry (oferta odrzucona, bo jej termin związania upłynął).
 *
 * PODSTAWA PRAWNA:
 *  - art. 220 Pzp — wykonawca jest związany ofertą do wskazanej w SWZ daty; maksymalna długość
 *    terminu zależy od wartości (30 / 90 / 120 dni). Zamawiający może raz zwrócić się o zgodę
 *    na przedłużenie o oznaczony okres (z jednoczesnym przedłużeniem wadium).
 *  - art. 226 ust. 1 pkt 4 — oferta z upływem terminu związania podlega odrzuceniu.
 *  - wadium musi zabezpieczać ofertę przez CAŁY termin związania (i jego przedłużenie).
 *
 * Czas wstrzykiwany; arytmetyka dat w UTC (przez `dataUtc`).
 */

import { naDzienUTC, roznicaDni, dzisiajUTC, odmianaDni } from './dataUtc.js';

/** Maksymalne długości terminu związania wg wartości (art. 220 ust. 1) — do podpowiedzi. */
export const MAKS_TERMINY = Object.freeze([
  { klucz: 'krajowy', dni: 30, etykieta: 'Poniżej progów unijnych — maks. 30 dni' },
  { klucz: 'unijny', dni: 90, etykieta: 'Od progów unijnych — maks. 90 dni' },
  { klucz: 'najwyzszy', dni: 120, etykieta: 'Najwyższe wartości — maks. 120 dni' },
]);

/**
 * Analiza terminu związania i pokrycia wadium.
 * @param {{terminZwiazania?: string, wadiumWazneDo?: string}} we
 * @param {number} teraz
 * @returns {{znany:boolean, dniDoKonca:number|null, poTerminie:boolean, wadiumPokrywa:boolean|null,
 *   wadiumDni:number|null, ton:string, etykieta:string, komunikat:string}}
 */
export function analizaZwiazania(we = {}, teraz = Date.now()) {
  const termin = naDzienUTC(we.terminZwiazania);
  const dzis = dzisiajUTC(teraz);
  if (termin === null) {
    return {
      znany: false, dniDoKonca: null, poTerminie: false, wadiumPokrywa: null, wadiumDni: null,
      ton: 'neutral', etykieta: 'Podaj termin związania ofertą', komunikat: '',
    };
  }
  const dniDoKonca = roznicaDni(dzis, termin);
  const poTerminie = dniDoKonca < 0;

  const wadium = naDzienUTC(we.wadiumWazneDo);
  const wadiumPokrywa = wadium === null ? null : wadium >= termin;
  const wadiumDni = wadium === null ? null : roznicaDni(dzis, wadium);

  let ton;
  let komunikat;
  if (poTerminie) {
    ton = 'danger';
    komunikat = 'Termin związania upłynął — oferta może zostać odrzucona (art. 226 ust. 1 pkt 4).';
  } else if (wadiumPokrywa === false) {
    ton = 'danger';
    komunikat = 'Wadium wygasa PRZED końcem terminu związania — załatw przedłużenie wadium, inaczej oferta odpada.';
  } else if (dniDoKonca <= 7) {
    ton = 'ostrzezenie';
    komunikat = 'Końcówka terminu — lada dzień może przyjść wezwanie do wyrażenia zgody na przedłużenie. Odpowiedz w terminie i przedłuż wadium.';
  } else {
    ton = 'neutral';
    komunikat = 'Pilnuj skrzynki: przy przeciągającym się postępowaniu przyjdzie wezwanie do przedłużenia terminu związania (i wadium).';
  }

  const etykieta = poTerminie
    ? `Po terminie o ${Math.abs(dniDoKonca)} ${odmianaDni(Math.abs(dniDoKonca))}`
    : dniDoKonca === 0
      ? 'Termin upływa dziś'
      : `Zostało ${dniDoKonca} ${odmianaDni(dniDoKonca)}`;

  return { znany: true, dniDoKonca, poTerminie, wadiumPokrywa, wadiumDni, ton, etykieta, komunikat };
}
