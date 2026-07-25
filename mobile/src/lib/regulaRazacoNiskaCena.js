/**
 * Reguła rażąco niskiej ceny — podzadanie 9/13 ulepszenia „Prześwietlenie oferty
 * zwycięzcy i szansa na odwołanie".
 *
 * WYŁĄCZNIE czysta funkcja jednej przesłanki odrzucenia: sprawdza, czy cena oferty
 * zwycięzcy jest rażąco niska względem pozostałych ofert. Bez UI, bez modelu, bez
 * storage. Zwraca gotowy do wyświetlenia zarzut: { wykryto, opis_zarzutu, sila }.
 * Kolejne podzadania zbiorą reguły w listę zarzutów z oceną szans.
 *
 * PODSTAWA PRAWNA — art. 224 ust. 2 pkt 1 Pzp: zamawiający MA OBOWIĄZEK wezwać
 * wykonawcę do wyjaśnień, gdy cena całkowita oferty jest niższa O CO NAJMNIEJ 30%
 * od średniej arytmetycznej cen wszystkich złożonych ofert (albo od wartości
 * zamówienia — tu porównujemy do średniej, bo takimi danymi dysponuje aplikacja).
 *
 * INTERPRETACJA PROGU: potoczne „poniżej 30% średniej" ze specyfikacji znaczy
 * właśnie „niższa o co najmniej 30% od średniej" (czyli cena ≤ 0,7 × średnia), a
 * NIE „poniżej 0,3 × średniej". Tak stanowi ustawa i tak liczy KIO — dosłowna
 * lektura (0,3× średniej) dawałaby próg oderwany od praktyki i przepuszczała realne
 * przypadki rażąco niskiej ceny.
 *
 * Deterministyczna i defensywna jak reszta czystych funkcji lib: nigdy nie rzuca,
 * przy braku/nieprawidłowych danych zwraca pełny kształt „nie wykryto"
 * ({ wykryto: false, opis_zarzutu: null, sila: null }). Bez Date.now(), bez
 * zewnętrznych/płatnych usług.
 */

import { formatBudget } from './format.js';

/**
 * Skala siły zarzutu — kontrakt dla wszystkich reguł analizy przesłanek odrzucenia
 * (jak `RODZAJE_PODPISU` w parserze oferty). Od najsłabszej do najmocniejszej;
 * kolejność jest znacząca. Ta reguła emituje tylko `umiarkowana`/`mocna` (samo
 * przekroczenie ustawowego progu 30% to już solidna podstawa); `slaba` zostaje w
 * skali dla reguł o mniejszym ciężarze (np. drobne braki formalne).
 */
export const SILA_ZARZUTU = ['slaba', 'umiarkowana', 'mocna'];

/** Ustawowy próg rażąco niskiej ceny wg art. 224 ust. 2 pkt 1 Pzp: 30% poniżej średniej. */
export const PROG_RAZACO_NISKA_CENY = 0.3;

/**
 * Próg eskalacji siły zarzutu z „umiarkowana" na „mocna". Nie wynika wprost z
 * ustawy — to ocena szans: im głębiej pod średnią, tym trudniej obronić cenę
 * wyjaśnieniami, więc od 50% poniżej średniej traktujemy zarzut jako mocny.
 */
const PROG_SILY_MOCNEJ = 0.5;

/**
 * Sprowadza wejście do dodatniej kwoty (Number) albo null. Akceptuje liczbę oraz
 * obiekt `{ kwota }` — taki kształt zwraca parser oferty ({@link
 * ./wyodrebnijPolaOferty wyodrebnij_pola_z_oferty}: `cena: { kwota, waluta, surowa }`).
 * Cena ≤ 0, NaN, nieskończoność i inne typy → null (nie zgadujemy kwoty).
 */
function naKwote(wartosc) {
  if (wartosc && typeof wartosc === 'object' && 'kwota' in wartosc) {
    return naKwote(wartosc.kwota);
  }
  if (typeof wartosc === 'number' && Number.isFinite(wartosc) && wartosc > 0) {
    return wartosc;
  }
  return null;
}

const NIE_WYKRYTO = Object.freeze({ wykryto: false, opis_zarzutu: null, sila: null });

/**
 * Ocena przesłanki rażąco niskiej ceny (art. 224 ust. 2 pkt 1 Pzp).
 *
 * Nazwa snake_case celowo zgodna ze specyfikacją — to kontrakt wołany przez
 * podzadanie zbierające zarzuty.
 *
 * @param {number|{kwota:number}} cena_zwyciezcy cena badanej (zwycięskiej) oferty —
 *   liczba albo obiekt `{ kwota }` (kształt z parsera oferty).
 * @param {Array<number|{kwota:number}>} oferty ceny WSZYSTKICH złożonych ofert
 *   (oferty są jawne od otwarcia — w tym zwycięska). Z nich liczymy średnią
 *   arytmetyczną. Wpisy nieprawidłowe/niedodatnie są pomijane.
 * @returns {{ wykryto: boolean, opis_zarzutu: string|null, sila: 'umiarkowana'|'mocna'|null }}
 *   `wykryto: false` z pustym opisem/siłą, gdy danych brakuje albo cena nie jest
 *   rażąco niska (nigdy nie rzuca).
 */
export function regula_razaco_niska_cena(cena_zwyciezcy, oferty) {
  const cena = naKwote(cena_zwyciezcy);
  if (cena === null) return { ...NIE_WYKRYTO };

  if (!Array.isArray(oferty)) return { ...NIE_WYKRYTO };
  const ceny = oferty.map(naKwote).filter((k) => k !== null);
  if (ceny.length === 0) return { ...NIE_WYKRYTO };

  const srednia = ceny.reduce((s, k) => s + k, 0) / ceny.length;
  if (!(srednia > 0)) return { ...NIE_WYKRYTO };

  // Ułamek, o jaki cena jest niższa od średniej. Porównujemy na ułamku różnicy,
  // nie na (cena ≤ 0,7 × średnia): mnożenie 0.7 × N bywa w IEEE754 minimalnie
  // mniejsze od N i gubiłoby dokładną granicę 30%.
  const ulamekPonizej = (srednia - cena) / srednia;
  if (ulamekPonizej < PROG_RAZACO_NISKA_CENY) return { ...NIE_WYKRYTO };

  const sila = ulamekPonizej >= PROG_SILY_MOCNEJ ? 'mocna' : 'umiarkowana';
  const procent = Math.round(ulamekPonizej * 100);

  const opis_zarzutu =
    `Cena oferty zwycięzcy (${formatBudget(cena)}) jest o ${procent}% niższa od ` +
    `średniej arytmetycznej cen złożonych ofert (${formatBudget(srednia)}) — ` +
    `przekracza to ustawowy próg 30% z art. 224 ust. 2 pkt 1 Pzp. Zamawiający miał ` +
    `obowiązek wezwać wykonawcę do wyjaśnień rażąco niskiej ceny; brak wezwania albo ` +
    `przyjęcie nieprzekonujących wyjaśnień jest podstawą zarzutu w odwołaniu do KIO.`;

  return { wykryto: true, opis_zarzutu, sila };
}
