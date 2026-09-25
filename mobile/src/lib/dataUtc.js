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

/*
 * ===== Strefa Europe/Warsaw (poprawka 2026-09-25) =====
 * Termin prawny upływa o 24:00 czasu POLSKIEGO, a „dziś" to dzień kalendarzowy w Polsce.
 * Wcześniej liczyliśmy koniec dnia i „dziś" wg północy UTC, czyli o 01:00 (zima) / 02:00
 * (lato) czasu polskiego — o 00:30 PL następnego dnia aplikacja pokazywała, że termin
 * jeszcze trwa, a wieczorem dnia granicznego zawyżała pozostały czas o 1–2 godziny.
 *
 * Świadomie BEZ `Intl`/toLocaleString: Hermes w React Native bywa budowany bez danych stref
 * czasowych, a termin nie może zależeć od ustawień telefonu. Reguła UE (dyrektywa
 * 2000/84/WE): czas letni CEST (UTC+2) od ostatniej niedzieli marca 01:00 UTC do ostatniej
 * niedzieli października 01:00 UTC, poza tym czas zimowy CET (UTC+1).
 */

const MS_GODZINA = 60 * 60 * 1000;

/** Dzień miesiąca, na który wypada ostatnia niedziela miesiąca (`miesiac0`: 0 = styczeń). */
function ostatniaNiedziela(rok, miesiac0) {
  const ostatni = new Date(Date.UTC(rok, miesiac0 + 1, 0)); // ostatni dzień miesiąca
  return ostatni.getUTCDate() - ostatni.getUTCDay();
}

/**
 * Przesunięcie czasu polskiego względem UTC w danej CHWILI (ms): 2 h w CEST, 1 h w CET.
 * @param {number} chwilaMs znacznik UTC
 * @returns {number}
 */
export function przesuniecieStrefyPL(chwilaMs) {
  const rok = new Date(chwilaMs).getUTCFullYear();
  const poczatekLata = Date.UTC(rok, 2, ostatniaNiedziela(rok, 2), 1);
  const koniecLata = Date.UTC(rok, 9, ostatniaNiedziela(rok, 9), 1);
  return chwilaMs >= poczatekLata && chwilaMs < koniecLata ? 2 * MS_GODZINA : MS_GODZINA;
}

/**
 * Dzień kalendarzowy w Polsce, w którym wypada chwila — jako znacznik UTC północy tego dnia
 * (ta sama reprezentacja co {@link naDzienUTC}, więc wyniki można porównywać i odejmować).
 * @param {number} chwilaMs
 * @returns {number|null}
 */
export function dzienPL(chwilaMs) {
  if (!Number.isFinite(chwilaMs)) return null;
  const d = new Date(chwilaMs + przesuniecieStrefyPL(chwilaMs));
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** „Dziś" w Polsce jako znacznik UTC północy (czas wstrzykiwany — domyślnie Date.now()). */
export function dzisiajPL(teraz = Date.now()) {
  return dzienPL(teraz);
}

/**
 * „Dziś" jako znacznik UTC północy — nazwa historyczna, zostaje dla wołających. Od 2026-09-25
 * zwraca dzień kalendarzowy W POLSCE (jak {@link dzisiajPL}): wg UTC między 00:00 a 01:00/02:00
 * czasu polskiego „dziś" było jeszcze wczoraj i terminy liczyły się o dzień za długo.
 */
export function dzisiajUTC(teraz = Date.now()) {
  return dzisiajPL(teraz);
}

/**
 * Chwila UTC, w której upływa dzień kalendarzowy D w Polsce — 24:00 czasu polskiego
 * (= 22:00 UTC latem, 23:00 UTC zimą). Tu kończy się termin prawny wyznaczony datą.
 * @param {number|null} dzienMs znacznik UTC północy dnia D (np. z {@link naDzienUTC})
 * @returns {number|null}
 */
export function koniecDniaPL(dzienMs) {
  if (dzienMs === null || dzienMs === undefined || !Number.isFinite(dzienMs)) return null;
  const polnocUTC = dzienMs + MS_DZIEN;
  // Zmiana czasu wypada o 01:00 UTC, nigdy o północy polskiej (22:00/23:00 UTC) — więc
  // przesunięcie o 00:00 UTC dnia D+1 jest tym samym, które obowiązuje o 24:00 PL dnia D.
  return polnocUTC - przesuniecieStrefyPL(polnocUTC);
}

/**
 * Godzina „na zegarze" w Polsce → chwila UTC (np. „termin do 20.01.2026, 15:00").
 * Godzinę nieistniejącą (wiosenna zmiana) liczymy jak czas letni, podwójną (jesienna) — jak zimowy.
 * @param {number} rok
 * @param {number} miesiac 1–12
 * @param {number} dzien
 * @param {number} [godz]
 * @param {number} [min]
 * @param {number} [sek]
 * @returns {number}
 */
export function chwilaPL(rok, miesiac, dzien, godz = 0, min = 0, sek = 0) {
  const naZegarze = Date.UTC(rok, miesiac - 1, dzien, godz, min, sek);
  // Pierwsze przybliżenie w CET (UTC+1), potem właściwe przesunięcie dla tej chwili.
  return naZegarze - przesuniecieStrefyPL(naZegarze - MS_GODZINA);
}

/** Odmiana „dzień/dni" — po polsku „dni" zawsze poza dokładnie jednym. */
export function odmianaDni(n) {
  return Math.abs(n) === 1 ? 'dzień' : 'dni';
}
