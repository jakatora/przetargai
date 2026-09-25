/**
 * Sprawdzarka formularza cenowego — wyłapuje BŁĘDY RACHUNKOWE i złą stawkę VAT, zanim
 * zamawiający je znajdzie (błąd rachunkowy = poprawa albo odrzucenie). Dla każdej pozycji
 * liczy wartość poprawnie i porównuje z tym, co wpisano w formularzu — wskazuje wiersz,
 * który się nie zgadza. Czysta arytmetyka pieniędzy, wejście toleruje polski przecinek.
 */

import { formatujPLN } from './kalkulatorCeny.js';
import { iloczynDoGroszy, procentDoGroszy, sumaGroszy } from './grosze.js';
import { bladKwoty, bladProcentu, bladLiczby, zbierzBledy } from './walidacjaLiczb.js';

export { formatujPLN };

function num(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
const pusta = (x) => x === '' || x === null || x === undefined;

/**
 * Sprawdza jeden wiersz. `wartoscPodana` (opcjonalna) = wartość netto wpisana w formularzu;
 * gdy podana i różni się od obliczonej → `bladWartosci`.
 *
 * Grosze (2026-09-25): wartość = DOKŁADNY iloczyn ilość × cena zaokrąglony połówką w górę
 * (wspólny `grosze.js`) — `Math.round(q*c*100)/100` dawał 0,5 × 2,01 = 1,00 i fałszywy błąd
 * rachunkowy przy poprawnym 1,01. VAT liczony PER WIERSZ od zaokrąglonej wartości netto,
 * brutto = netto + VAT. Uwaga: część formularzy liczy VAT raz od sumy netto (wynik może się
 * różnić o grosze) — przejście na VAT od sumy to decyzja właściciela produktu, nie tej poprawki.
 */
export function sprawdzWiersz({ nazwa = '', ilosc, cenaJedn, vat, wartoscPodana } = {}) {
  const q = num(ilosc);
  const c = num(cenaJedn);
  const v = num(vat);
  const obliczona = iloczynDoGroszy([q, c]);
  const vatKwota = procentDoGroszy(obliczona, v);
  const brutto = sumaGroszy([obliczona, vatKwota]);
  const podana = pusta(wartoscPodana) ? null : num(wartoscPodana);
  const bladWartosci = podana !== null && Math.abs(podana - obliczona) > 0.001;
  return { nazwa, ilosc: q, cenaJedn: c, vat: v, obliczona, vatKwota, brutto, podana, bladWartosci, maDane: q > 0 && c > 0 };
}

/**
 * @param {Array<object>} wiersze pozycje formularza
 * @returns {{pozycje: object[], sumaNetto, sumaVat, sumaBrutto, liczbaBledow: number,
 *   aktywnych: number, bledy: Array<{indeks:number, nazwa:string, podana:number, obliczona:number}>}}
 */
export function sprawdzFormularz(wiersze) {
  const pozycje = (Array.isArray(wiersze) ? wiersze : []).map((w, i) => ({ indeks: i, ...sprawdzWiersz(w) }));
  const aktywne = pozycje.filter((p) => p.maDane);
  const sumaNetto = sumaGroszy(aktywne.map((p) => p.obliczona));
  const sumaVat = sumaGroszy(aktywne.map((p) => p.vatKwota));
  const sumaBrutto = sumaGroszy(aktywne.map((p) => p.brutto));
  const bledy = aktywne
    .filter((p) => p.bladWartosci)
    .map((p) => ({ indeks: p.indeks, nazwa: p.nazwa, podana: p.podana, obliczona: p.obliczona }));
  return { pozycje, sumaNetto, sumaVat, sumaBrutto, liczbaBledow: bledy.length, aktywnych: aktywne.length, bledy };
}

/** Najwyższa stawka VAT w Polsce (%) — wyższa wartość w formularzu to na pewno pomyłka. */
export const VAT_MAX = 23;

/** Pola liczbowe pozycji walidowane jawnie (klucze błędów: `${pole}_${indeks}`). */
const POLA_POZYCJI = ['ilosc', 'cenaJedn', 'vat', 'wartoscPodana'];

/**
 * Waliduje pola liczbowe pozycji formularza — zamiast cicho zerować błędne pole (np.
 * „1.200,50" w wartości z formularza → fałszywe „masz 0,00 zł"), zwraca komunikat PL
 * pod każde pole. Puste pole = brak błędu (stan pusty ekranu).
 * Uwaga: to błędy PÓL; niezgodności rachunkowe zwraca {@link sprawdzFormularz} (`bledy`).
 * @param {Array<{ilosc?, cenaJedn?, vat?, wartoscPodana?}>} wiersze
 * @returns {{bledy: {[klucz:string]: string}, maBledy: boolean}} klucze `ilosc_0`, `vat_1`…
 */
export function walidujFormularz(wiersze) {
  const mapa = {};
  (Array.isArray(wiersze) ? wiersze : []).forEach((w, i) => {
    mapa[`ilosc_${i}`] = bladLiczby(w?.ilosc, { min: 0 });
    mapa[`cenaJedn_${i}`] = bladKwoty(w?.cenaJedn);
    mapa[`vat_${i}`] = bladProcentu(w?.vat, { max: VAT_MAX, etykieta: 'Stawka VAT' });
    mapa[`wartoscPodana_${i}`] = bladKwoty(w?.wartoscPodana);
  });
  return zbierzBledy(mapa);
}

/** Czy pozycja o indeksie `i` ma choć jeden błąd pola (wynik z {@link walidujFormularz}). */
export function maBladPozycji(bledy, i) {
  return POLA_POZYCJI.some((pole) => Boolean(bledy?.[`${pole}_${i}`]));
}
