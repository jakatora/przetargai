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
 * Treść SWZ postępowania wraz ze źródłem. Wołający odpowiada za sprawdzenie WŁASNOŚCI
 * postępowania — ta funkcja czyta po samym identyfikatorze.
 * @param {string} postepowanieId
 * @returns {{zrodlo: 'wersja'|'wklejona'|'brak', tresc: string, zapisana_at: string|null}}
 */
export function trescSwzPostepowania(postepowanieId) {
  const wersja = swzWersje.latestForPostepowanie(postepowanieId);
  if (wersja) {
    // Wersja bez treści inline (sama ścieżka do pliku) nie daje tekstu do parsera, ale
    // nadal jest NOWSZA niż cokolwiek wklejonego — nie cofamy się do starszej treści.
    const tresc = wersja.tresc ?? '';
    return tresc.trim()
      ? { zrodlo: ZRODLO_TRESCI.WERSJA, tresc, zapisana_at: wersja.created_at }
      : { zrodlo: ZRODLO_TRESCI.BRAK, tresc: '', zapisana_at: null };
  }
  const wklejona = swzTrescWklejona.get(postepowanieId);
  if (wklejona) return { zrodlo: ZRODLO_TRESCI.WKLEJONA, tresc: wklejona.tresc, zapisana_at: wklejona.created_at };
  return { zrodlo: ZRODLO_TRESCI.BRAK, tresc: '', zapisana_at: null };
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
 * @param {{postepowanieId: string, swz: string|null|undefined}} wejscie
 * @returns {{zapisano: boolean, zrodlo: 'wersja'|'wklejona'|'brak', zapisana_at: string|null}}
 *   `zapisano` = ten właśnie zapis utworzył wiersz; reszta to stan PO próbie.
 */
export function zapamietajWklejonaSwz({ postepowanieId, swz }) {
  if (typeof swz !== 'string' || !swz.trim()) return { zapisano: false, ...stanTresciSwz(postepowanieId) };
  const { created } = swzTrescWklejona.zapiszPierwsza({ postepowanieId, hash: hasz(swz), tresc: swz });
  return { zapisano: created, ...stanTresciSwz(postepowanieId) };
}
