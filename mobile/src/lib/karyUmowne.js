/**
 * Kalkulator kar umownych — ile realnie zapłacisz kar za zwłokę i odstąpienie, i po ilu
 * dniach zwłoki sięgasz limitu kar. Do policzenia PRZED podpisem umowy: kary potrafią zjeść
 * cały zysk, a łączny limit (zwykle 20–30% wartości) decyduje o maksymalnym ryzyku.
 *
 * Czysta arytmetyka; wejście toleruje polski przecinek i puste pola. `formatujPLN`
 * współdzielony z kalkulatorem ceny (jedno źródło formatowania kwot).
 */

import { formatujPLN } from './kalkulatorCeny.js';

export { formatujPLN };

function num(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
const grosze = (n) => Math.round(n * 100) / 100;

/**
 * @param {{wartosc?, stawkaZwlokiProc?, dniZwloki?, odstapienieProc?, limitProc?}} we
 * @returns {{karaZwloki, karaOdstapienia, suma, limitKwota: number|null, przekroczono: boolean,
 *   doZaplaty, dniDoLimitu: number|null, maDane: boolean}} kwoty zaokrąglone do groszy.
 */
export function policzKary({ wartosc, stawkaZwlokiProc, dniZwloki, odstapienieProc, limitProc } = {}) {
  const w = num(wartosc);
  const dziennaZwloka = w * (num(stawkaZwlokiProc) / 100);
  const karaZwloki = dziennaZwloka * num(dniZwloki);
  const karaOdstapienia = w * (num(odstapienieProc) / 100);
  const suma = karaZwloki + karaOdstapienia;

  const maLimit = num(limitProc) > 0;
  const limitKwota = maLimit ? w * (num(limitProc) / 100) : null;
  const przekroczono = maLimit && suma > limitKwota;
  const doZaplaty = maLimit ? Math.min(suma, limitKwota) : suma;
  // Ile dni SAMEJ zwłoki wyczerpuje limit (najgorszy scenariusz zwłoki bez odstąpienia).
  const dniDoLimitu = maLimit && dziennaZwloka > 0 ? Math.floor(limitKwota / dziennaZwloka) : null;

  return {
    karaZwloki: grosze(karaZwloki),
    karaOdstapienia: grosze(karaOdstapienia),
    suma: grosze(suma),
    limitKwota: maLimit ? grosze(limitKwota) : null,
    przekroczono,
    doZaplaty: grosze(doZaplaty),
    dniDoLimitu,
    maDane: w > 0,
  };
}
