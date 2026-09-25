/**
 * Kalkulator ceny ofertowej — buduje cenę od kosztów: koszty bezpośrednie → narzut
 * kosztów pośrednich → zysk → VAT → cena brutto. Pomaga ustawić cenę, która wygrywa,
 * a nie topi (i którą da się obronić przy zarzucie rażąco niskiej ceny).
 *
 * Czysta arytmetyka pieniędzy — zaokrąglenia do groszy, wejście toleruje przecinek
 * dziesiętny (polski format) i puste/niepoprawne pola (→ 0). Całość testowalna.
 */

import { bladKwoty, bladProcentu, zbierzBledy } from './walidacjaLiczb.js';
import { doGroszy, iloczynDoGroszy, procentDoGroszy, sumaGroszy } from './grosze.js';

/** Dozwolone stawki VAT w zamówieniach publicznych (procenty). */
export const STAWKI_VAT = [23, 8, 5, 0];

/** Parsuje liczbę z pola tekstowego: przecinek→kropka, ujemne/niepoprawne→0. */
function liczba(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Grosze (2026-09-25): każdy etap łańcucha zaokrąglamy do groszy wspólnym `grosze.js`
 * (dokładnie, połówka w górę) i następny liczymy od ZAOKRĄGLONEGO poprzedniego — VAT od
 * zaokrąglonego netto, brutto = netto + VAT. Wcześniej `Math.round` na nieprzyciętych
 * floatach dawał np. 29,50 + VAT 6,79 = brutto 36,28, a tabela nie sumowała się do grosza.
 * @param {{material?, robocizna?, inne?, narzutProc?, zyskProc?, vatProc?}} we
 *   kwoty i procenty jako liczby lub stringi (z przecinkiem/spacjami).
 * @returns {{bezposrednie, posrednie, kosztWytworzenia, zysk, netto, vat, brutto,
 *   udzialZyskuProc, maDane: boolean}} wszystkie kwoty zaokrąglone do groszy.
 */
export function policzCene({ material, robocizna, inne, narzutProc, zyskProc, vatProc } = {}) {
  const bezposrednie = sumaGroszy([liczba(material), liczba(robocizna), liczba(inne)]);
  const posrednie = procentDoGroszy(bezposrednie, liczba(narzutProc));
  const kosztWytworzenia = sumaGroszy([bezposrednie, posrednie]);
  const zysk = procentDoGroszy(kosztWytworzenia, liczba(zyskProc));
  const netto = sumaGroszy([kosztWytworzenia, zysk]);
  const vat = procentDoGroszy(netto, liczba(vatProc));
  const brutto = sumaGroszy([netto, vat]);
  // udział zysku w % = zysk × 100 / netto (netto 0 → dzielnik 0 → 0)
  const udzialZyskuProc = iloczynDoGroszy([zysk, 100], netto);

  return {
    bezposrednie,
    posrednie,
    kosztWytworzenia,
    zysk,
    netto,
    vat,
    brutto,
    udzialZyskuProc,
    maDane: bezposrednie > 0,
  };
}

/**
 * Waliduje wejście kalkulatora ceny — zamiast cicho zerować błędne pola,
 * zwraca jawne komunikaty PL pod każde pole. Puste pole = brak błędu (stan pusty).
 * @param {{material?, robocizna?, inne?, narzutProc?, zyskProc?}} we
 * @returns {{bledy: {[pole:string]: string}, maBledy: boolean}}
 */
export function walidujCene({ material, robocizna, inne, narzutProc, zyskProc } = {}) {
  return zbierzBledy({
    material: bladKwoty(material),
    robocizna: bladKwoty(robocizna),
    inne: bladKwoty(inne),
    narzutProc: bladProcentu(narzutProc, { max: 1000, etykieta: 'Narzut' }),
    zyskProc: bladProcentu(zyskProc, { max: 1000, etykieta: 'Zysk' }),
  });
}

/** Formatuje kwotę PLN po polsku bez Intl (Hermes bywa okrojony): „12 345,67 zł". */
export function formatujPLN(n) {
  const zaokr = doGroszy(n); // wspólne zaokrąglenie (1,005 → 1,01); nie-liczba → 0
  const [calosc, ulamek] = Math.abs(zaokr).toFixed(2).split('.');
  const cyfry = calosc.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${zaokr < 0 ? '-' : ''}${cyfry},${ulamek} zł`;
}
