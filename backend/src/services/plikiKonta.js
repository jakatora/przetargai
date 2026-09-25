import { logger } from '../lib/logger.js';
import { magazynNaDysku as magazynSejfuNaDysku } from './sejfDokumentow.js';
import { magazynNaDysku as magazynSkrzynkiNaDysku } from './czarnaSkrzynka.js';

/*
 * Pliki użytkownika na dysku przy USUNIĘCIU KONTA (RODO art. 17) — 2026-09-25.
 *
 * `DELETE /auth/me` kasuje wiersze kaskadą SQLite (sejf_dokumenty, czarna_skrzynka_*),
 * ale oryginały na wolumenie (zaświadczenia KRK/ZUS/US, zrzuty ekranu, oryginał oferty)
 * zostawały na zawsze — dane osobowe po „usuniętym" koncie. Klucze plików trzeba zebrać
 * PRZED usunięciem wierszy (po kaskadzie nie ma już skąd ich wziąć), a skasować PO nim —
 * gdy usunięcie konta się nie uda, pliki zostają razem z kontem.
 */

/**
 * Zbiera klucze plików użytkownika z bazy (przed kaskadowym usunięciem konta).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} userId
 * @returns {{sejf: string[], czarnaSkrzynka: string[]}}
 */
export function zbierzPlikiKonta(db, userId) {
  const sejf = db.prepare(
    'SELECT plik_url AS klucz FROM sejf_dokumenty WHERE user_id = ? AND plik_url IS NOT NULL',
  ).all(userId).map((r) => r.klucz);

  const skrzynka = new Set();
  for (const r of db.prepare(
    'SELECT plik_oferty_url AS klucz FROM czarna_skrzynka_sesja WHERE user_id = ? AND plik_oferty_url IS NOT NULL',
  ).all(userId)) skrzynka.add(r.klucz);
  for (const r of db.prepare(`
    SELECT z.plik_url AS klucz
      FROM czarna_skrzynka_zdarzenie z
      JOIN czarna_skrzynka_sesja s ON s.id = z.sesja_id
     WHERE s.user_id = ? AND z.plik_url IS NOT NULL`,
  ).all(userId)) skrzynka.add(r.klucz);

  return { sejf, czarnaSkrzynka: [...skrzynka] };
}

/**
 * Kasuje zebrane pliki z magazynów. Fail-open: konto jest już usunięte, więc błąd dysku
 * logujemy (sierota do ręcznego sprzątnięcia), zamiast zwracać użytkownikowi 500.
 * @param {{sejf: string[], czarnaSkrzynka: string[]}} pliki
 * @param {{magazynSejfu?: {usun: Function}, magazynSkrzynki?: {usun: Function}}} [deps]
 * @returns {number} liczba faktycznie usuniętych plików
 */
export function usunPlikiKonta(
  { sejf = [], czarnaSkrzynka = [] } = {},
  { magazynSejfu = magazynSejfuNaDysku(), magazynSkrzynki = magazynSkrzynkiNaDysku() } = {},
) {
  let usuniete = 0;
  const kasuj = (magazyn, klucz) => {
    try {
      if (magazyn.usun(klucz)) usuniete++;
    } catch (err) {
      logger.warn({ err: err.message }, 'plikiKonta: nie usunięto pliku po usunięciu konta');
    }
  };
  for (const klucz of sejf) kasuj(magazynSejfu, klucz);
  for (const klucz of czarnaSkrzynka) kasuj(magazynSkrzynki, klucz);
  return usuniete;
}
