/**
 * Symulator punktacji oferty — liczy, ile punktów zdobędziesz w każdym kryterium i łącznie,
 * wg proporcjonalnego wzoru Pzp. Pokazuje, gdzie tracisz punkty i czy warto docisnąć np.
 * gwarancję zamiast schodzić z ceną.
 *
 * Wzory (art. 242 Pzp, standard w SWZ):
 *  • kryterium „mniej = lepiej" (cena): pkt = waga × (najlepsza / twoja)   [najlepsza = najniższa]
 *  • kryterium „więcej = lepiej" (gwarancja, doświadczenie): pkt = waga × (twoja / najlepsza)
 * Wynik przycinamy do wagi (nie da się dostać więcej niż maksimum kryterium).
 * Czysta arytmetyka, wejście toleruje polski przecinek i puste pola.
 */

import { analizujPole, bladLiczby, zbierzBledy } from './walidacjaLiczb.js';

export const KIERUNKI = [
  { wartosc: 'min', etykieta: 'Niżej = lepiej', przyklad: 'np. cena' },
  { wartosc: 'max', etykieta: 'Wyżej = lepiej', przyklad: 'np. gwarancja' },
];

function num(x) {
  const n = Number(String(x ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
const zaokr = (n) => Math.round(n * 100) / 100;

/**
 * Punkty za jedno kryterium. Zwraca `null`, gdy dane są niekompletne/niepoprawne
 * (waga, twoja i najlepsza muszą być liczbami dodatnimi).
 */
export function punktyKryterium({ waga, twoja, najlepsza, kierunek } = {}) {
  const w = num(waga); const t = num(twoja); const n = num(najlepsza);
  if (!(w > 0) || !(t > 0) || !(n > 0)) return null;
  const stosunek = kierunek === 'max' ? t / n : n / t;
  return zaokr(Math.min(w, w * stosunek)); // nie przekracza wagi kryterium
}

/**
 * Symuluje całą punktację.
 * @param {Array<{nazwa?, waga, twoja, najlepsza, kierunek}>} kryteria
 * @returns {{pozycje: object[], sumaPkt: number, sumaWag: number, procent: number, kompletnych: number}}
 */
export function symuluj(kryteria) {
  const pozycje = (Array.isArray(kryteria) ? kryteria : []).map((k) => ({
    ...k,
    pkt: punktyKryterium(k),
  }));
  const kompletne = pozycje.filter((p) => p.pkt !== null);
  const sumaWag = kompletne.reduce((s, k) => s + num(k.waga), 0);
  const sumaPkt = kompletne.reduce((s, k) => s + k.pkt, 0);
  return {
    pozycje,
    sumaPkt: zaokr(sumaPkt),
    sumaWag: zaokr(sumaWag),
    procent: sumaWag > 0 ? zaokr((100 * sumaPkt) / sumaWag) : 0,
    kompletnych: kompletne.length,
  };
}

/** Maksymalna waga jednego kryterium — punktacja SWZ to łącznie 100 pkt (= 100%). */
export const WAGA_MAX = 100;

/** Pola liczbowe kryterium walidowane jawnie (klucze błędów: `${pole}_${indeks}`). */
const POLA_KRYTERIUM = ['waga', 'twoja', 'najlepsza'];

/** Waga: liczba 0–WAGA_MAX, ale 0 pkt nie ma sensu (kryterium wypadłoby z sumy). */
function bladWagi(waga) {
  const blad = bladLiczby(waga, { min: 0, max: WAGA_MAX });
  if (blad) return blad;
  return analizujPole(waga).liczba === 0 ? 'Waga musi być większa od 0' : null;
}

/**
 * Waliduje dynamiczną listę kryteriów — zamiast cicho gubić kryterium z błędną liczbą
 * („— uzupełnij dane") albo liczyć wagę 150 pkt, zwraca komunikat PL pod każde pole.
 * Puste pole = brak błędu (stan pusty ekranu).
 * @param {Array<{waga?, twoja?, najlepsza?}>} kryteria
 * @returns {{bledy: {[klucz:string]: string}, maBledy: boolean}} klucze `waga_0`, `twoja_1`…
 */
export function walidujKryteria(kryteria) {
  const mapa = {};
  (Array.isArray(kryteria) ? kryteria : []).forEach((k, i) => {
    mapa[`waga_${i}`] = bladWagi(k?.waga);
    mapa[`twoja_${i}`] = bladLiczby(k?.twoja, { min: 0 });
    mapa[`najlepsza_${i}`] = bladLiczby(k?.najlepsza, { min: 0 });
  });
  return zbierzBledy(mapa);
}

/** Czy kryterium o indeksie `i` ma choć jeden błąd pola (wynik z {@link walidujKryteria}). */
export function maBladKryterium(bledy, i) {
  return POLA_KRYTERIUM.some((pole) => Boolean(bledy?.[`${pole}_${i}`]));
}
