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
