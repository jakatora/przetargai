/*
 * „Wklej pozycje z SWZ" — parser tabeli formularza cenowego wklejonej z PDF/Worda/Excela.
 * Zamiast przepisywać 40 pozycji ręcznie, wykonawca wkleja tekst i dostaje wiersze
 * gotowe do wyceny w Sprawdzarce formularza cenowego.
 *
 * Heurystyka, świadomie DEFENSYWNA: wiersz bez rozpoznanej ilości jest pomijany
 * (lepiej dopisać ręcznie niż wstawić śmieci do dokumentu dla zamawiającego).
 * Obsługiwane układy:
 *  • kolumny rozdzielone tabulatorem, `|` albo `;` (Excel/Word/Markdown):
 *    lp | nazwa | jm | ilość [| cena jedn. [| wartość]]
 *  • tekst z PDF bez separatorów: „1. Nazwa pozycji m2 450" — ilość na końcu,
 *    jednostka tuż przed nią, reszta to nazwa.
 * Nagłówki („Lp", „Nazwa", „Ilość"…) i podsumowania („Razem", „Suma", „Ogółem") odpadają.
 * CZYSTA logika, nigdy nie rzuca.
 */

const LICZBA = /^-?\d{1,3}(?:[  ]\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/;
const JEDNOSTKA = /^(m2|m²|m3|m³|mb|m|szt\.?|kpl\.?|kg|t|l|godz\.?|rbg|r-g|h|km|ha|ar|op\.?|kompl\.?|zest\.?|usł\.?|pkt|dni|mies\.?|km\/h)$/i;
const NAGLOWEK = /^(lp\.?|l\.p\.?|nr|poz\.?|nazwa|opis|przedmiot|asortyment|j\.?\s?m\.?|jedn\.?|jednostka|ilo[sś][cć]|liczba|cena|warto[sś][cć]|vat|stawka|netto|brutto)\b/i;
const PODSUMOWANIE = /^(razem|suma|ogółem|ogolem|łącznie|lacznie|total|wartość oferty|wartosc oferty)/i;
const LP = /^\d{1,3}[.)]?$/;

const czysc = (s) => String(s ?? '').replace(/ /g, ' ').trim();
const jestLiczba = (s) => LICZBA.test(czysc(s));

function zKolumn(kolumny) {
  const k = kolumny.map(czysc).filter((x, i, arr) => !(x === '' && (i === 0 || i === arr.length - 1)));
  if (k.length < 2) return null;
  let lp = null;
  if (LP.test(k[0])) lp = k.shift().replace(/[.)]$/, '');
  // Liczby na końcu wiersza: ilość [cena] [wartość] — czytamy od prawej.
  const liczby = [];
  while (k.length && jestLiczba(k[k.length - 1])) liczby.unshift(k.pop());
  // Ostatnia kolumna tekstowa przed liczbami bywa jednostką.
  let jm = '';
  if (k.length && JEDNOSTKA.test(k[k.length - 1])) jm = k.pop();
  const nazwa = k.join(' ').replace(/\s+/g, ' ').trim();
  if (!nazwa || liczby.length === 0) return null;
  if (NAGLOWEK.test(nazwa) && liczby.length === 0) return null;
  const [ilosc, cenaJedn, wartoscPodana] = liczby;
  const poz = { lp, nazwa, jm, ilosc };
  if (cenaJedn !== undefined) poz.cenaJedn = cenaJedn;
  if (wartoscPodana !== undefined) poz.wartoscPodana = wartoscPodana;
  return poz;
}

function zTekstu(linia) {
  // „1. Nazwa … jm ilość" — ilość to ostatni token-liczba; jednostka tuż przed nią.
  const tokeny = linia.split(/\s+/);
  let lp = null;
  if (tokeny.length && LP.test(tokeny[0])) lp = tokeny.shift().replace(/[.)]$/, '');
  if (tokeny.length < 2) return null;
  const ostatni = tokeny[tokeny.length - 1];
  if (!jestLiczba(ostatni)) return null;
  tokeny.pop();
  let jm = '';
  if (tokeny.length && JEDNOSTKA.test(tokeny[tokeny.length - 1])) jm = tokeny.pop();
  const nazwa = tokeny.join(' ').trim();
  if (!nazwa || jestLiczba(nazwa)) return null;
  return { lp, nazwa, jm, ilosc: ostatni };
}

/**
 * @param {string} tekst wklejona tabela
 * @returns {Array<{lp: string|null, nazwa: string, jm: string, ilosc: string, cenaJedn?: string, wartoscPodana?: string}>}
 */
export function parsujPozycjeFormularza(tekst) {
  if (typeof tekst !== 'string' || !tekst.trim()) return [];
  const wynik = [];
  for (const surowa of tekst.split(/\r?\n/)) {
    const linia = czysc(surowa).replace(/^\|/, '').replace(/\|$/, '').trim();
    if (!linia) continue;
    const pierwszySens = linia.replace(/^[|;\t\s]+/, '');
    if (NAGLOWEK.test(pierwszySens) || PODSUMOWANIE.test(pierwszySens)) continue;
    let poz = null;
    if (/\t|\||;/.test(linia)) poz = zKolumn(linia.split(/\t|\||;/));
    else if (/\s{2,}/.test(linia)) poz = zKolumn(linia.split(/\s{2,}/));
    else poz = zTekstu(linia);
    if (poz && !PODSUMOWANIE.test(poz.nazwa) && !NAGLOWEK.test(poz.nazwa)) wynik.push(poz);
  }
  return wynik;
}

/** Pozycje → wiersze ekranu Sprawdzarki (ten sam kształt co ręczne wiersze). */
export function naWierszeSprawdzarki(pozycje, { vat = '23', odId = 0 } = {}) {
  return (Array.isArray(pozycje) ? pozycje : []).map((p, i) => ({
    id: `w${odId + i}`,
    nazwa: p.jm ? `${p.nazwa} (${p.jm})` : p.nazwa,
    ilosc: p.ilosc ?? '',
    cenaJedn: p.cenaJedn ?? '',
    vat: String(vat),
    wartoscPodana: p.wartoscPodana ?? '',
  }));
}
