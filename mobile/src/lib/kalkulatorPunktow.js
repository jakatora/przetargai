/**
 * „KALKULATOR PUNKTÓW — wygraj kryteriami, nie najniższą ceną" — czysta logika bez React
 * Native (testowalna `node:test`). Liczy „cenę punktu": ile realnie warta jest przewaga w
 * kryteriach pozacenowych, czyli o ile DROŻSZĄ ofertę możesz dać i wciąż wygrać.
 *
 * Model (head-to-head Ty vs konkurent), zgodny z typową punktacją Pzp:
 *  • Cena: punkty = wagaCeny × (cena_najniższa / cena_oferty)   [art. 242 — kryterium ceny].
 *  • Kryterium „większe lepiej" (gwarancja, doświadczenie): punkty = waga × wartość/najlepsza.
 *  • Kryterium „mniejsze lepiej" (termin): punkty = waga × najlepsza/wartość.
 * „najlepsza"/„najniższa" liczone są względem DWÓCH ofert (Twojej i konkurenta), bo w Pzp
 * punkty pozacenowe są relatywne do najlepszej złożonej oferty.
 *
 * Kluczowy wynik: `cenaBreakEven` — najwyższa Twoja cena, przy której nadal remisujesz z tym
 * konkurentem (trzymając kryteria stałe). Powyżej niej przegrywasz mimo lepszej jakości.
 * Wszystko deterministyczne; braki liczymy ostrożnie (NaN/≤0 → 0 pkt).
 */

function liczba(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Punkty jednego kryterium pozacenowego względem lepszej z dwóch wartości. */
export function punktKryterium(wartosc, przeciwnik, waga, kierunek = 'max') {
  const w = liczba(waga);
  const a = liczba(wartosc);
  const b = liczba(przeciwnik);
  if (w <= 0) return 0;
  if (kierunek === 'min') {
    const najlepsza = Math.min(a > 0 ? a : Infinity, b > 0 ? b : Infinity);
    if (!Number.isFinite(najlepsza) || a <= 0) return 0;
    return w * (najlepsza / a);
  }
  const najlepsza = Math.max(a, b);
  if (najlepsza <= 0) return 0;
  return w * (a / najlepsza);
}

/**
 * Pełna analiza pojedynku punktowego.
 * @param {{mojaCena:number, konkurencyjnaCena:number, wagaCeny:number,
 *   kryteria: Array<{nazwa:string, waga:number, kierunek?:'max'|'min', moje:number, konkurent:number}>}} we
 * @returns {Readonly<object>} { mojePkt, konkPkt, roznica, wygrywam, cenaBreakEven, pctRoznica,
 *   bezLimitu, mojaCenaPkt, konkCenaPkt, rozbicie }
 */
export function analizaPunktow(we = {}) {
  const wagaCeny = Math.max(0, liczba(we.wagaCeny));
  const mojaCena = liczba(we.mojaCena);
  const konkCena = liczba(we.konkurencyjnaCena);
  const kryteria = Array.isArray(we.kryteria) ? we.kryteria : [];

  // Punkty pozacenowe (relatywne do lepszej z dwóch ofert).
  let mojePoza = 0;
  let konkPoza = 0;
  const rozbicie = kryteria.map((kr) => {
    const moje = punktKryterium(kr.moje, kr.konkurent, kr.waga, kr.kierunek);
    const konk = punktKryterium(kr.konkurent, kr.moje, kr.waga, kr.kierunek);
    mojePoza += moje;
    konkPoza += konk;
    return Object.freeze({ nazwa: kr.nazwa ?? '', moje, konkurent: konk, waga: liczba(kr.waga) });
  });

  // Punkty ceny (najniższa z dwóch = pełna waga).
  const cenaMin = Math.min(mojaCena > 0 ? mojaCena : Infinity, konkCena > 0 ? konkCena : Infinity);
  const mojaCenaPkt = mojaCena > 0 && Number.isFinite(cenaMin) ? wagaCeny * (cenaMin / mojaCena) : 0;
  const konkCenaPkt = konkCena > 0 && Number.isFinite(cenaMin) ? wagaCeny * (cenaMin / konkCena) : 0;

  const mojePkt = mojePoza + mojaCenaPkt;
  const konkPkt = konkPoza + konkCenaPkt;
  const konkTotal = konkPoza + konkCenaPkt;

  // cenaBreakEven: najwyższa moja cena, przy której total ≥ total konkurenta.
  // total_moje(c) = mojePoza + wagaCeny·konkCena/c  (dla c ≥ konkCena) = konkTotal ⇒
  //   c = wagaCeny·konkCena / (konkTotal − mojePoza).
  const mianownik = konkTotal - mojePoza;
  let cenaBreakEven = null;
  let bezLimitu = false;
  if (konkCena > 0 && wagaCeny > 0) {
    if (mianownik <= 0) {
      bezLimitu = true; // przewaga jakością przewyższa całą wagę ceny — wygrywasz przy każdej cenie
    } else {
      cenaBreakEven = (wagaCeny * konkCena) / mianownik;
    }
  }
  const pctRoznica = cenaBreakEven !== null && konkCena > 0
    ? (cenaBreakEven - konkCena) / konkCena
    : null;

  return Object.freeze({
    mojePkt: round2(mojePkt),
    konkPkt: round2(konkPkt),
    roznica: round2(mojePkt - konkPkt),
    wygrywam: mojePkt >= konkPkt,
    mojaCenaPkt: round2(mojaCenaPkt),
    konkCenaPkt: round2(konkCenaPkt),
    cenaBreakEven: cenaBreakEven === null ? null : Math.round(cenaBreakEven),
    pctRoznica,
    bezLimitu,
    rozbicie,
  });
}

function round2(x) {
  return Math.round(liczba(x) * 100) / 100;
}
