/**
 * Kalkulator kar umownych — ile realnie zapłacisz kar za zwłokę i odstąpienie, i po ilu
 * dniach zwłoki sięgasz limitu kar. Do policzenia PRZED podpisem umowy: kary potrafią zjeść
 * cały zysk, a łączny limit (zwykle 20–30% wartości) decyduje o maksymalnym ryzyku.
 *
 * Czysta arytmetyka; wejście toleruje polski przecinek i puste pola. `formatujPLN`
 * współdzielony z kalkulatorem ceny (jedno źródło formatowania kwot).
 */

import { formatujPLN } from './kalkulatorCeny.js';
import { iloczynDoGroszy, procentDoGroszy, sumaGroszy } from './grosze.js';
import { bladKwoty, bladProcentu, bladLiczby, zbierzBledy } from './walidacjaLiczb.js';

export { formatujPLN };

function num(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Grosze (2026-09-25): kwoty liczone DOKŁADNIE wspólnym `grosze.js` (połówka w górę) —
 * `Math.round` na floatach dawał np. 10,35 zł × 10% = 1,03 zamiast 1,04. Suma i kwota do
 * zapłaty to suma ZAOKRĄGLONYCH kar, więc zgadza się z wierszami co do grosza.
 * @param {{wartosc?, stawkaZwlokiProc?, dniZwloki?, odstapienieProc?, limitProc?}} we
 * @returns {{karaZwloki, karaOdstapienia, suma, limitKwota: number|null, przekroczono: boolean,
 *   doZaplaty, dniDoLimitu: number|null, maDane: boolean}} kwoty zaokrąglone do groszy.
 */
export function policzKary({ wartosc, stawkaZwlokiProc, dniZwloki, odstapienieProc, limitProc } = {}) {
  const w = num(wartosc);
  const stawka = num(stawkaZwlokiProc);
  const dziennaZwloka = w * (stawka / 100);
  const karaZwloki = iloczynDoGroszy([w, stawka, num(dniZwloki)], 100);
  const karaOdstapienia = procentDoGroszy(w, num(odstapienieProc));
  const suma = sumaGroszy([karaZwloki, karaOdstapienia]);

  const maLimit = num(limitProc) > 0;
  const limitKwota = maLimit ? procentDoGroszy(w, num(limitProc)) : null;
  const przekroczono = maLimit && suma > limitKwota;
  const doZaplaty = maLimit ? Math.min(suma, limitKwota) : suma;
  // Ile dni SAMEJ zwłoki wyczerpuje limit (najgorszy scenariusz zwłoki bez odstąpienia).
  const dniDoLimitu = maLimit && dziennaZwloka > 0 ? Math.floor(limitKwota / dziennaZwloka) : null;

  return {
    karaZwloki,
    karaOdstapienia,
    suma,
    limitKwota,
    przekroczono,
    doZaplaty,
    dniDoLimitu,
    maDane: w > 0,
  };
}

/**
 * Waliduje wejście kalkulatora kar — zamiast cicho zerować błędne pola (np. „1.200,50"),
 * zwraca jawne komunikaty PL pod każde pole. Puste pole = brak błędu (stan pusty).
 * Zakresy: kara za zwłokę 0–10% DZIENNIE (typowo 0,01–1%; „20" zamiast „0,20" to literówka,
 * która wyczerpałaby limit w kilka dni), dni zwłoki całkowite 0–3650 (10 lat),
 * odstąpienie i limit kar 0–100% wartości umowy.
 * @param {{wartosc?, stawkaZwlokiProc?, dniZwloki?, odstapienieProc?, limitProc?}} we
 * @returns {{bledy: {[pole:string]: string}, maBledy: boolean}}
 */
export function walidujKary({ wartosc, stawkaZwlokiProc, dniZwloki, odstapienieProc, limitProc } = {}) {
  return zbierzBledy({
    wartosc: bladKwoty(wartosc),
    stawkaZwlokiProc: bladProcentu(stawkaZwlokiProc, { max: 10, etykieta: 'Kara za zwłokę' }),
    dniZwloki: bladLiczby(dniZwloki, { min: 0, max: 3650, calkowita: true }),
    odstapienieProc: bladProcentu(odstapienieProc, { max: 100, etykieta: 'Kara za odstąpienie' }),
    limitProc: bladProcentu(limitProc, { max: 100, etykieta: 'Limit kar' }),
  });
}
