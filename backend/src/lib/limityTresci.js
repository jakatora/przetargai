import { z } from 'zod';
import { AppError } from './errors.js';

/*
 * Twarde limity treści dokumentów (SWZ / wzór umowy / przedmiar) przyjmowanych w JSON-ie
 * (P0, 2026-09-25).
 *
 * Parser trasy wpuszcza do 10 MB, a treść SWZ szła dalej bez żadnej granicy: do diffu
 * wersji (dawniej LCS O(n·m) w wątku głównym — 8 tys. linii to 3,9 s i 366 MB, ~20 tys.
 * to OOM i przestój WSZYSTKICH aplikacji na tym procesie) i do płatnego AI. Realne SWZ
 * z załącznikami to kilkaset tysięcy znaków i kilka-kilkanaście tysięcy linii, więc
 * 2 mln znaków i 50 tys. linii zostawia duży zapas dla uczciwego użytkownika, a odcina
 * wejście, które mogłoby zatrzymać serwer.
 *
 * Limit żyje W SCHEMACIE zod (jedno miejsce prawdy dla każdej trasy), a przekroczenie
 * zamieniamy na 413 z czytelnym komunikatem PL (`bladLimituTresci`) — zamiast ogólnego
 * „Podaj treść…", który sugerowałby, że treści zabrakło.
 */

export const MAKS_ZNAKOW_TRESCI = 2_000_000;
export const MAKS_LINII_TRESCI = 50_000;

const KOMUNIKAT_ZNAKI = `Treść jest za długa — limit to ${MAKS_ZNAKOW_TRESCI.toLocaleString('pl-PL')} znaków. `
  + 'Podziel dokument albo wklej tylko istotne rozdziały.';
const KOMUNIKAT_LINIE = `Treść ma za dużo linii — limit to ${MAKS_LINII_TRESCI.toLocaleString('pl-PL')} linii. `
  + 'Podziel dokument albo wklej tylko istotne rozdziały.';
const KOMUNIKATY_LIMITU = new Set([KOMUNIKAT_ZNAKI, KOMUNIKAT_LINIE]);

/** Liczba linii tak, jak liczy je diff (`split(/\r?\n/)`): liczba „\n" + 1. Bez alokacji. */
export function liczbaLinii(tekst) {
  let n = 1;
  for (let i = tekst.indexOf('\n'); i !== -1; i = tekst.indexOf('\n', i + 1)) n++;
  return n;
}

/**
 * Pole z treścią dokumentu: string z limitem znaków i linii. Linie liczymy tylko, gdy
 * limit znaków przeszedł (`abort`), żeby nie skanować wielomegabajtowego śmiecia dwa razy.
 */
export function trescDokumentu() {
  return z.string()
    .max(MAKS_ZNAKOW_TRESCI, { message: KOMUNIKAT_ZNAKI, abort: true })
    .refine((s) => liczbaLinii(s) <= MAKS_LINII_TRESCI, { message: KOMUNIKAT_LINIE });
}

/**
 * Z błędu walidacji zod wyłuskuje przekroczenie limitu treści i zamienia je na 413
 * `ZA_DLUGA_TRESC` z nazwą pola. Inne błędy walidacji => null (trasa rzuca swój 400).
 * @param {import('zod').ZodError|undefined} error
 * @returns {AppError|null}
 */
export function bladLimituTresci(error) {
  const issue = error?.issues?.find((i) => KOMUNIKATY_LIMITU.has(i.message));
  if (!issue) return null;
  const pole = issue.path?.join('.') || 'treść';
  return new AppError(413, 'ZA_DLUGA_TRESC', `Pole "${pole}": ${issue.message}`);
}
