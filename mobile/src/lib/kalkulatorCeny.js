/**
 * Kalkulator ceny ofertowej — buduje cenę od kosztów: koszty bezpośrednie → narzut
 * kosztów pośrednich → zysk → VAT → cena brutto. Pomaga ustawić cenę, która wygrywa,
 * a nie topi (i którą da się obronić przy zarzucie rażąco niskiej ceny).
 *
 * Czysta arytmetyka pieniędzy — zaokrąglenia do groszy, wejście toleruje przecinek
 * dziesiętny (polski format) i puste/niepoprawne pola (→ 0). Całość testowalna.
 */

/** Dozwolone stawki VAT w zamówieniach publicznych (procenty). */
export const STAWKI_VAT = [23, 8, 5, 0];

/** Parsuje liczbę z pola tekstowego: przecinek→kropka, ujemne/niepoprawne→0. */
function liczba(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const grosze = (n) => Math.round(n * 100) / 100;

/**
 * @param {{material?, robocizna?, inne?, narzutProc?, zyskProc?, vatProc?}} we
 *   kwoty i procenty jako liczby lub stringi (z przecinkiem/spacjami).
 * @returns {{bezposrednie, posrednie, kosztWytworzenia, zysk, netto, vat, brutto,
 *   udzialZyskuProc, maDane: boolean}} wszystkie kwoty zaokrąglone do groszy.
 */
export function policzCene({ material, robocizna, inne, narzutProc, zyskProc, vatProc } = {}) {
  const bezposrednie = liczba(material) + liczba(robocizna) + liczba(inne);
  const posrednie = bezposrednie * (liczba(narzutProc) / 100);
  const kosztWytworzenia = bezposrednie + posrednie;
  const zysk = kosztWytworzenia * (liczba(zyskProc) / 100);
  const netto = kosztWytworzenia + zysk;
  const vat = netto * (liczba(vatProc) / 100);
  const brutto = netto + vat;
  const udzialZysku = netto > 0 ? zysk / netto : 0;

  return {
    bezposrednie: grosze(bezposrednie),
    posrednie: grosze(posrednie),
    kosztWytworzenia: grosze(kosztWytworzenia),
    zysk: grosze(zysk),
    netto: grosze(netto),
    vat: grosze(vat),
    brutto: grosze(brutto),
    udzialZyskuProc: grosze(udzialZysku * 100),
    maDane: bezposrednie > 0,
  };
}

/** Formatuje kwotę PLN po polsku bez Intl (Hermes bywa okrojony): „12 345,67 zł". */
export function formatujPLN(n) {
  const zaokr = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  const [calosc, ulamek] = Math.abs(zaokr).toFixed(2).split('.');
  const cyfry = calosc.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${zaokr < 0 ? '-' : ''}${cyfry},${ulamek} zł`;
}
