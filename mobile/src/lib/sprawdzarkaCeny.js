/**
 * Sprawdzarka formularza cenowego — wyłapuje BŁĘDY RACHUNKOWE i złą stawkę VAT, zanim
 * zamawiający je znajdzie (błąd rachunkowy = poprawa albo odrzucenie). Dla każdej pozycji
 * liczy wartość poprawnie i porównuje z tym, co wpisano w formularzu — wskazuje wiersz,
 * który się nie zgadza. Czysta arytmetyka pieniędzy, wejście toleruje polski przecinek.
 */

import { formatujPLN } from './kalkulatorCeny.js';

export { formatujPLN };

function num(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
const grosze = (n) => Math.round(n * 100) / 100;
const pusta = (x) => x === '' || x === null || x === undefined;

/**
 * Sprawdza jeden wiersz. `wartoscPodana` (opcjonalna) = wartość netto wpisana w formularzu;
 * gdy podana i różni się od obliczonej → `bladWartosci`.
 */
export function sprawdzWiersz({ nazwa = '', ilosc, cenaJedn, vat, wartoscPodana } = {}) {
  const q = num(ilosc);
  const c = num(cenaJedn);
  const v = num(vat);
  const obliczona = grosze(q * c);
  const vatKwota = grosze((obliczona * v) / 100);
  const brutto = grosze(obliczona + vatKwota);
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
  const sumaNetto = grosze(aktywne.reduce((s, p) => s + p.obliczona, 0));
  const sumaVat = grosze(aktywne.reduce((s, p) => s + p.vatKwota, 0));
  const sumaBrutto = grosze(aktywne.reduce((s, p) => s + p.brutto, 0));
  const bledy = aktywne
    .filter((p) => p.bladWartosci)
    .map((p) => ({ indeks: p.indeks, nazwa: p.nazwa, podana: p.podana, obliczona: p.obliczona }));
  return { pozycje, sumaNetto, sumaVat, sumaBrutto, liczbaBledow: bledy.length, aktywnych: aktywne.length, bledy };
}
