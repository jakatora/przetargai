/**
 * Wspólna arytmetyka DAT KALENDARZOWYCH w UTC (liczymy dni, nie chwile) — wydzielona z
 * `terminKio.js`, żeby narzędzia liczące ważność (referencje, wadium, termin związania,
 * wezwania) nie duplikowały parsowania i walidacji daty i dawały ten sam wynik na teście,
 * telefonie i backendzie niezależnie od strefy czasowej.
 *
 * Zasada: czas „teraz" jest WSTRZYKIWANY parametrem — moduł jest deterministyczny (bez
 * ukrytego Date.now()), więc testy `node:test` liczą daty ręcznie z kotwicą.
 */

export const MS_DZIEN = 24 * 60 * 60 * 1000;

/**
 * Sprowadza wejście (Date lub string ISO/„YYYY-MM-DD") do znacznika UTC północy dnia albo
 * null. Bierze pierwsze 10 znaków stringa, żeby strefa czasowa nie przesuwała dnia, i
 * ODRZUCA daty, które Date.UTC po cichu znormalizował (2026-02-30, 2026-13-01) — dla
 * terminu prawnego wolimy null niż przesuniętą datę.
 * @param {string|Date|null|undefined} wartosc
 * @returns {number|null} ms UTC północy albo null
 */
export function naDzienUTC(wartosc) {
  if (wartosc instanceof Date) {
    if (Number.isNaN(wartosc.getTime())) return null;
    return Date.UTC(wartosc.getUTCFullYear(), wartosc.getUTCMonth(), wartosc.getUTCDate());
  }
  if (typeof wartosc === 'string') {
    const m = wartosc.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      const d = new Date(wartosc);
      if (Number.isNaN(d.getTime())) return null;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    const rok = Number(m[1]);
    const mies = Number(m[2]);
    const dzien = Number(m[3]);
    const ms = Date.UTC(rok, mies - 1, dzien);
    const d = new Date(ms);
    if (d.getUTCFullYear() !== rok || d.getUTCMonth() !== mies - 1 || d.getUTCDate() !== dzien) {
      return null;
    }
    return ms;
  }
  return null;
}

/**
 * Dodaje `lata` lat do znacznika UTC, z bezpiecznym 29 lutego → 28 lutego (gdy rok docelowy
 * nie jest przestępny). Zwraca null dla złego wejścia.
 * @param {number|null} ms znacznik UTC północy
 * @param {number} lata liczba lat (może być ujemna)
 * @returns {number|null}
 */
export function dodajLata(ms, lata) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const rok = d.getUTCFullYear() + Math.trunc(lata);
  const mies = d.getUTCMonth();
  const dzien = d.getUTCDate();
  const wynik = Date.UTC(rok, mies, dzien);
  const w = new Date(wynik);
  // 29 II → rok nieprzestępny: Date.UTC przeskoczyłby na 1 III — cofamy na ostatni dzień lutego.
  if (w.getUTCMonth() !== mies) return Date.UTC(rok, mies + 1, 0);
  return wynik;
}

/** Różnica w pełnych dniach (doMs − odMs). Dodatnia = `doMs` w przyszłości względem `odMs`. */
export function roznicaDni(odMs, doMs) {
  if (!Number.isFinite(odMs) || !Number.isFinite(doMs)) return null;
  return Math.round((doMs - odMs) / MS_DZIEN);
}

/** „Dziś" jako znacznik UTC północy (czas wstrzykiwany — domyślnie Date.now()). */
export function dzisiajUTC(teraz = Date.now()) {
  const d = new Date(teraz);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Odmiana „dzień/dni" — po polsku „dni" zawsze poza dokładnie jednym. */
export function odmianaDni(n) {
  return Math.abs(n) === 1 ? 'dzień' : 'dni';
}
