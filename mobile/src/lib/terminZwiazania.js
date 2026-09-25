/**
 * „STRAŻNIK TERMINU ZWIĄZANIA OFERTĄ" — czysta logika (testowalna `node:test`).
 *
 * PROBLEM: postępowanie się przeciąga, zbliża się koniec terminu związania ofertą; zamawiający
 * przysyła wezwanie do wyrażenia zgody na przedłużenie — przegapione pismo albo wygasłe wadium
 * = wypadnięcie z gry (oferta odrzucona, bo jej termin związania upłynął).
 *
 * PODSTAWA PRAWNA:
 *  - art. 220 ust. 2 Pzp — zamawiający określa termin związania ofertą DATĄ w dokumentach
 *    zamówienia; wykonawca jest nim związany do tej daty.
 *  - maksymalna długość: 90 / 120 dni (art. 220 ust. 1 pkt 1 / pkt 2), w trybie podstawowym
 *    30 dni (art. 307 ust. 1) — liczone od dnia upływu terminu składania ofert, przy czym TEN
 *    dzień jest pierwszym dniem terminu (reguła szczególna wobec art. 111 § 2 KC, gdzie dnia
 *    zdarzenia się nie liczy). Poprawka 2026-09-25: wcześniej całość podpisana „art. 220 ust. 1",
 *    także 30 dni z trybu podstawowego.
 *  - art. 220 ust. 3 — zamawiający może JEDNOKROTNIE zwrócić się o zgodę na przedłużenie
 *    (w trybie podstawowym analogicznie art. 307), z jednoczesnym przedłużeniem wadium.
 *  - art. 226 ust. 1 pkt 4 — oferta z upływem terminu związania podlega odrzuceniu.
 *  - wadium musi zabezpieczać ofertę przez CAŁY termin związania (i jego przedłużenie).
 *
 * Czas wstrzykiwany; arytmetyka dat w UTC (przez `dataUtc`), a „dziś" to dzień w Polsce.
 */

import { naDzienUTC, roznicaDni, dzisiajPL, odmianaDni } from './dataUtc.js';

/**
 * Maksymalne długości terminu związania — do podpowiedzi, każda z własną podstawą prawną.
 * Kod NIE wylicza końca terminu związania (bierze datę z SWZ), więc reguła „pierwszym dniem
 * jest dzień upływu terminu składania ofert" trafia tylko do opisu {@link BIEG_TERMINU_ZWIAZANIA}.
 */
export const MAKS_TERMINY = Object.freeze([
  { klucz: 'krajowy', dni: 30, podstawa: 'art. 307 ust. 1 Pzp', etykieta: 'Tryb podstawowy (poniżej progów unijnych) — maks. 30 dni' },
  { klucz: 'unijny', dni: 90, podstawa: 'art. 220 ust. 1 pkt 1 Pzp', etykieta: 'Od progów unijnych — maks. 90 dni' },
  { klucz: 'najwyzszy', dni: 120, podstawa: 'art. 220 ust. 1 pkt 2 Pzp', etykieta: 'Roboty budowlane od 20 mln euro, dostawy i usługi od 10 mln euro — maks. 120 dni' },
]);

/** Jak biegnie termin związania — reguła z art. 220 ust. 1 i art. 307 ust. 1 Pzp, z przykładem. */
export const BIEG_TERMINU_ZWIAZANIA =
  'Pierwszym dniem terminu związania jest dzień upływu terminu składania ofert — np. 30 dni '
  + 'przy terminie składania ofert 10.03 kończy się 08.04 (nie 09.04).';

/**
 * Analiza terminu związania i pokrycia wadium.
 * @param {{terminZwiazania?: string, wadiumWazneDo?: string}} we
 * @param {number} teraz
 * @returns {{znany:boolean, dniDoKonca:number|null, poTerminie:boolean, wadiumPokrywa:boolean|null,
 *   wadiumDni:number|null, ton:string, etykieta:string, komunikat:string}}
 */
export function analizaZwiazania(we = {}, teraz = Date.now()) {
  const termin = naDzienUTC(we.terminZwiazania);
  // Poprawka 2026-09-25: dzień kalendarzowy w POLSCE — wg UTC o 00:30 PL „dziś" było jeszcze
  // wczoraj i termin, który już upłynął, pokazywał się jako „upływa dziś".
  const dzis = dzisiajPL(teraz);
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
