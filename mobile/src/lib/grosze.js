/**
 * Kwoty w groszach — JEDNO źródło zaokrąglania dla kalkulatorów pieniężnych (sprawdzarka
 * formularza cenowego, kalkulator ceny, kary umowne, odsetki). Czysta logika, testowalna.
 *
 * Dlaczego (2026-09-25): `Math.round(n * 100) / 100` na liczbie zmiennoprzecinkowej myli się
 * na połówkach grosza — 0,5 × 2,01 = 1,005, ale w pamięci to 1,00499999…, więc wychodziło 1,00
 * zamiast 1,01 (fałszywy „błąd rachunkowy" w sprawdzarce), a VAT 23% od 29,50 zł dawał brutto
 * 36,28 zamiast 29,50 + 6,79 = 36,29. `Number.EPSILON` tego nie łata (błąd rośnie z kwotą).
 *
 * Jak: każdą liczbę bierzemy w jej najkrótszym zapisie dziesiętnym JS (`String(2.01)` = "2.01"
 * — dokładnie to, co wpisał użytkownik), iloczyn liczymy DOKŁADNIE na liczbach całkowitych
 * (BigInt), a końcówkę ≥ 0,5 grosza zaokrąglamy w górę (od zera) — tak jak kwoty podatku
 * (art. 106e ust. 11 ustawy o VAT). Sumy liczymy na całkowitych groszach, więc np.
 * brutto = netto + VAT zawsze zgadza się co do grosza.
 */

const ZERO = BigInt(0);
const JEDEN = BigInt(1);
const DWA = BigInt(2);
const STO = BigInt(100);

/** 10^k jako BigInt (k ≥ 0) — bez operatora `**`, żeby nie zależeć od wsparcia silnika. */
function potega10(k) {
  return BigInt(`1${'0'.repeat(k)}`);
}

/**
 * Dokładny zapis dziesiętny liczby: x = m / 10^skala (m całkowite). Źródłem jest najkrótszy
 * zapis JS, także wykładniczy („1e-7", „1.5e+21"). Niepoprawne/nieskończone → 0.
 */
function dziesietna(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n === 0) return { m: ZERO, skala: 0 };
  const [mantysa, wykladnik = '0'] = String(n).toLowerCase().split('e');
  const ujemna = mantysa.startsWith('-');
  const [calk, ulamek = ''] = mantysa.replace('-', '').split('.');
  let cyfry = calk + ulamek;
  let skala = ulamek.length - Number(wykladnik);
  if (skala < 0) {
    cyfry += '0'.repeat(-skala);
    skala = 0;
  }
  const m = BigInt(cyfry);
  return { m: ujemna ? -m : m, skala };
}

/**
 * Dokładny wynik (czynnik₁ × czynnik₂ × …) / dzielnik w CAŁKOWITYCH groszach, końcówka
 * ≥ 0,5 grosza w górę (od zera). Niepoprawny czynnik liczy się jak 0.
 * @param {Array<number|string>} czynniki np. [ilość, cena] albo [kwota, stawka%, dni]
 * @param {number} [dzielnik=1] np. 100 dla procentu, 36500 dla stawki rocznej % za dni
 * @returns {number} liczba całkowita groszy (0 dla dzielnika 0)
 */
export function groszeIloczynu(czynniki, dzielnik = 1) {
  let licznik = STO; // wynik w groszach = złote × 100
  let skala = 0;
  for (const c of Array.isArray(czynniki) ? czynniki : []) {
    const d = dziesietna(c);
    licznik *= d.m;
    skala += d.skala;
  }
  const dz = dziesietna(dzielnik);
  if (dz.m === ZERO) return 0;
  // wartość = licznik / 10^skala / (dz.m / 10^dz.skala)
  let l = licznik * potega10(dz.skala);
  let m = potega10(skala) * dz.m;
  if (m < ZERO) {
    m = -m;
    l = -l;
  }
  const ujemny = l < ZERO;
  const modul = ujemny ? -l : l;
  const q = (DWA * modul + m) / (DWA * m); // ⌊modul/m + ½⌋ — połówka w górę
  return Number(ujemny ? -q : q);
}

/** Jak {@link groszeIloczynu}, ale w złotych (np. 1.01). */
export function iloczynDoGroszy(czynniki, dzielnik = 1) {
  return groszeIloczynu(czynniki, dzielnik) / 100;
}

/** Kwota zaokrąglona do groszy (połówka w górę), np. 1.005 → 1.01. */
export function doGroszy(x) {
  return iloczynDoGroszy([x]);
}

/** `procent`% od `kwota`, zaokrąglone do groszy, np. VAT 23% od 29.50 → 6.79. */
export function procentDoGroszy(kwota, procent) {
  return iloczynDoGroszy([kwota, procent], 100);
}

/** Suma kwot, każda zaokrąglona do groszy, liczona na całkowitych groszach (bez ogona float). */
export function sumaGroszy(kwoty) {
  const lista = Array.isArray(kwoty) ? kwoty : [];
  return lista.reduce((s, k) => s + groszeIloczynu([k]), 0) / 100;
}

/**
 * Dokładne ⌈a / b⌉ dla liczb dziesiętnych ≥ 0 (np. limit 20% / 0,3% dziennie = 67 dni;
 * float dałby 0,3 / 0,1 = 2,9999…). Dzielnik ≤ 0 albo ujemna dzielna → null.
 */
export function ilorazWGore(a, b) {
  const x = dziesietna(a);
  const y = dziesietna(b);
  if (y.m <= ZERO || x.m < ZERO) return null;
  const l = x.m * potega10(y.skala);
  const m = y.m * potega10(x.skala);
  return Number((l + m - JEDEN) / m);
}
