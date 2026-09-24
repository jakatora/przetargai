/**
 * Wybór języka PL/EN — czysta logika, zero importów z React Native.
 *
 * Backend oddaje teksty jako pary `{ pl, en }` (opisy źródeł, stan pobierania,
 * wyjaśnienie dopasowania, zastrzeżenie o zakresie danych). To jest JEDYNE
 * miejsce, które z takiej pary wybiera wariant — i jedyne, które wie, co robić,
 * gdy pary nie ma albo brakuje w niej jednego języka.
 *
 * Interfejs aplikacji zostaje domyślnie POLSKI. To dobudowa dla ekranów, które
 * i tak renderują teksty z backendu, a nie przebudowa całego UI: stary ekran
 * z polskim literałem działa bez zmian, bo `tr('Zapisane')` oddaje go nietknięty.
 */

export const JEZYKI = ['pl', 'en'];
export const JEZYK_DOMYSLNY = 'pl';

/** Klucz w magazynie lokalnym — wybór przeżywa restart aplikacji. */
export const KLUCZ_JEZYKA = 'przetargai.jezyk';

/** Etykiety w SWOIM języku — przełącznik ma być czytelny dla obu grup. */
export const ETYKIETY_JEZYKOW = { pl: 'Polski', en: 'English' };

/** Śmieci z magazynu i warianty regionalne („en-GB") sprowadzone do kodu języka. */
export function normalizujJezyk(surowy) {
  if (!surowy) return JEZYK_DOMYSLNY;
  const kod = String(surowy).toLowerCase().split(/[-_]/)[0];
  return JEZYKI.includes(kod) ? kod : JEZYK_DOMYSLNY;
}

/**
 * Język startowy z ustawienia systemu telefonu.
 *
 * Wszystko poza angielskim to polski — rynek jest polski, a niemiecki czy
 * ukraiński system nie znaczy, że użytkownik woli angielski interfejs nad
 * językiem dokumentów, z którymi pracuje.
 */
export function wykryjJezyk(locale) {
  return normalizujJezyk(locale) === 'en' ? 'en' : JEZYK_DOMYSLNY;
}

/**
 * Wybiera wariant językowy.
 *
 * @param {{pl?: string, en?: string}|string|number|null} tekst para z backendu,
 *   gotowy string (stare ekrany) albo nic
 * @param {'pl'|'en'} jezyk
 * @returns {string} zawsze string — nigdy „undefined" na ekranie
 */
export function tr(tekst, jezyk = JEZYK_DOMYSLNY) {
  if (tekst === null || tekst === undefined) return '';
  if (typeof tekst === 'string') return tekst;
  if (typeof tekst === 'number') return String(tekst);

  const kod = normalizujJezyk(jezyk);
  // Brak tłumaczenia spada na drugi język, a nie na pustkę: niedokończony
  // przekład ma wyglądać jak niedokończony przekład, nie jak awaria ekranu.
  const drugi = kod === 'pl' ? 'en' : 'pl';
  return tekst[kod] ?? tekst[drugi] ?? '';
}

/**
 * Tłumacz z domkniętym językiem — ekran dostaje go z kontekstu i woła krótko.
 * Przyjmuje parę jako obiekt albo jako dwa argumenty (skrót dla literałów).
 */
export function tworzTlumacza(jezyk) {
  const kod = normalizujJezyk(jezyk);
  return (tekst, en) => (en === undefined ? tr(tekst, kod) : tr({ pl: tekst, en }, kod));
}
