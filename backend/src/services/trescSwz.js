import { createHash } from 'node:crypto';
import { swzWersje, swzTrescWklejona } from '../db/repos.js';

/*
 * TREŚĆ SWZ POSTĘPOWANIA — skąd ją bierzemy do dopasowania dokumentów (2026-10-03).
 *
 * Dwa źródła o RÓŻNYM znaczeniu:
 *   • `swz_wersja`         — wersje opublikowane przez zamawiającego (trasa `/odswiez`,
 *                            monitor publikacji); mają datę publikacji i zasilają
 *                            silnik różnic,
 *   • `swz_tresc_wklejona` — treść, którą użytkownik wkleił do pierwszej analizy;
 *                            nie jest publikacją i nigdy nie trafia do silnika różnic.
 *
 * Pierwszeństwo ma wersja opublikowana: jest nowsza z definicji (wklejoną zapisujemy
 * tylko, gdy żadnej wersji jeszcze nie ma) i to ją zamawiający uznaje za wiążącą.
 * Wklejona treść jest zapasem na czas, zanim użytkownik poda pierwszą publikację.
 */

/** Skąd pochodzi treść SWZ postępowania. */
export const ZRODLO_TRESCI = Object.freeze({
  WERSJA: 'wersja',       // najnowsza wersja opublikowana (swz_wersja)
  WKLEJONA: 'wklejona',   // treść wklejona przez użytkownika do analizy
  BRAK: 'brak',           // postępowanie nie ma zapisanej treści SWZ
});

const hasz = (tresc) => createHash('sha256').update(String(tresc ?? '')).digest('hex');

/**
 * Początki stron PDF-a zapisane przy treści (JSON) → tablica albo null. Przyjmujemy tylko spójne:
 * liczby całkowite, niemalejące, w granicach treści — inaczej numer strony mógłby wskazać złą stronę.
 */
export function poczatkiStron(json, tresc) {
  if (json == null) return null;
  let p;
  try { p = typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; }
  const dl = String(tresc ?? '').length;
  const ok = Array.isArray(p) && p.length > 0
    && p.every((x, i) => Number.isInteger(x) && x >= 0 && x <= dl && (i === 0 || x >= p[i - 1]));
  return ok ? p : null;
}

/**
 * Treść SWZ postępowania wraz ze źródłem. Wołający odpowiada za sprawdzenie WŁASNOŚCI
 * postępowania — ta funkcja czyta po samym identyfikatorze.
 * @param {string} postepowanieId
 * `strony` — początki stron PDF-a w `tresc` (tylko treść z pliku PDF; inaczej null).
 * @returns {{zrodlo: 'wersja'|'wklejona'|'brak', tresc: string, zapisana_at: string|null, strony: number[]|null}}
 */
export function trescSwzPostepowania(postepowanieId) {
  const wersja = swzWersje.latestForPostepowanie(postepowanieId);
  if (wersja) {
    // Wersja bez treści inline (sama ścieżka do pliku) nie daje tekstu do parsera, ale
    // nadal jest NOWSZA niż cokolwiek wklejonego — nie cofamy się do starszej treści.
    const tresc = wersja.tresc ?? '';
    return tresc.trim()
      ? { zrodlo: ZRODLO_TRESCI.WERSJA, tresc, zapisana_at: wersja.created_at, strony: null }
      : { zrodlo: ZRODLO_TRESCI.BRAK, tresc: '', zapisana_at: null, strony: null };
  }
  const wklejona = swzTrescWklejona.get(postepowanieId);
  if (wklejona) {
    return { zrodlo: ZRODLO_TRESCI.WKLEJONA, tresc: wklejona.tresc, zapisana_at: wklejona.created_at, strony: poczatkiStron(wklejona.strony, wklejona.tresc) };
  }
  return { zrodlo: ZRODLO_TRESCI.BRAK, tresc: '', zapisana_at: null, strony: null };
}

/** To samo bez treści — do odpowiedzi API (panel pokazuje tylko, czy i skąd treść jest). */
export function stanTresciSwz(postepowanieId) {
  const { zrodlo, zapisana_at } = trescSwzPostepowania(postepowanieId);
  return { zrodlo, zapisana_at };
}

/**
 * Zapamiętuje SWZ wklejoną do analizy. Wołać PRZED płatnym AI: treść ma przetrwać brak
 * klucza, wyczerpany budżet, dobowy limit i błąd modelu. Pusta treść => nic nie robi.
 *
 * Niczego nie nadpisuje i nie tworzy wersji opublikowanej ani wpisu zmiany:
 *   • postępowanie ma już wersję opublikowaną  => zapis pominięty,
 *   • ma już treść wklejoną (ponowienie/wyścig) => zostaje ta pierwsza.
 *
 * @param {{postepowanieId: string, swz: string|null|undefined, strony?: number[]|null}} wejscie
 *   `strony` — początki stron PDF-a w `swz` (treść z pliku), zapisywane razem z treścią.
 * @returns {{zapisano: boolean, zrodlo: 'wersja'|'wklejona'|'brak', zapisana_at: string|null}}
 *   `zapisano` = ten właśnie zapis utworzył wiersz; reszta to stan PO próbie.
 */
export function zapamietajWklejonaSwz({ postepowanieId, swz, strony = null }) {
  if (typeof swz !== 'string' || !swz.trim()) return { zapisano: false, ...stanTresciSwz(postepowanieId) };
  const poczatki = poczatkiStron(strony, swz);
  const { created } = swzTrescWklejona.zapiszPierwsza({ postepowanieId, hash: hasz(swz), tresc: swz, strony: poczatki ? JSON.stringify(poczatki) : null });
  return { zapisano: created, ...stanTresciSwz(postepowanieId) };
}
