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

/** Komunikaty walidacji — jawne, po polsku, zamiast cichego zerowania błędnego wejścia. */
const KOMUNIKAT_KWOTA_NIE_LICZBA = 'Podaj kwotę jako liczbę, np. 1200,00';
const KOMUNIKAT_KWOTA_UJEMNA = 'Kwota nie może być ujemna';
const KOMUNIKAT_PROCENT_NIE_LICZBA = 'Podaj procent jako liczbę, np. 10';

/**
 * Klasyfikuje pojedyncze pole liczbowe po wstępnym oczyszczeniu (jak `oczysc`
 * w ekranie: tylko cyfry/przecinek/kropka/spacja, tu dodatkowo minus dla ujemnych).
 * @returns {{pusty: boolean, liczba: number|null}} liczba=null gdy tekst nie jest liczbą.
 */
function analizujPole(x) {
  const oczyszczone = String(x ?? '').replace(/[^0-9.,\- ]/g, '');
  const bezSpacji = oczyszczone.replace(/\s/g, '').replace(/,/g, '.');
  if (bezSpacji === '') return { pusty: true, liczba: null };
  const n = Number(bezSpacji);
  return { pusty: false, liczba: Number.isFinite(n) ? n : null };
}

/**
 * Waliduje wejście kalkulatora ceny — zamiast cicho zerować błędne pola,
 * zwraca jawne komunikaty PL pod każde pole. Puste pole = brak błędu (stan pusty).
 * @param {{material?, robocizna?, inne?, narzutProc?, zyskProc?}} we
 * @returns {{bledy: {[pole:string]: string}, maBledy: boolean}}
 */
export function walidujCene({ material, robocizna, inne, narzutProc, zyskProc } = {}) {
  const bledy = {};

  const sprawdzKwote = (pole, wartosc) => {
    const { pusty, liczba: n } = analizujPole(wartosc);
    if (pusty) return;
    if (n === null) bledy[pole] = KOMUNIKAT_KWOTA_NIE_LICZBA;
    else if (n < 0) bledy[pole] = KOMUNIKAT_KWOTA_UJEMNA;
  };

  const sprawdzProcent = (pole, wartosc, etykieta) => {
    const { pusty, liczba: n } = analizujPole(wartosc);
    if (pusty) return;
    if (n === null) bledy[pole] = KOMUNIKAT_PROCENT_NIE_LICZBA;
    else if (n < 0 || n > 1000) bledy[pole] = `${etykieta} spoza zakresu 0–1000%`;
  };

  sprawdzKwote('material', material);
  sprawdzKwote('robocizna', robocizna);
  sprawdzKwote('inne', inne);
  sprawdzProcent('narzutProc', narzutProc, 'Narzut');
  sprawdzProcent('zyskProc', zyskProc, 'Zysk');

  return { bledy, maBledy: Object.keys(bledy).length > 0 };
}

/** Formatuje kwotę PLN po polsku bez Intl (Hermes bywa okrojony): „12 345,67 zł". */
export function formatujPLN(n) {
  const zaokr = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  const [calosc, ulamek] = Math.abs(zaokr).toFixed(2).split('.');
  const cyfry = calosc.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${zaokr < 0 ? '-' : ''}${cyfry},${ulamek} zł`;
}
