/**
 * Katalog zdarzeń analitycznych + budowniczy rekordu zdarzenia.
 *
 * Czysta warstwa (bez React, bez sieci) — nazwy zdarzeń i kształt rekordu żyją tu,
 * żeby były SPÓJNE (jeden słownik nazw zamiast literałów rozsypanych po ekranach) i
 * dały się przetestować bez renderera. Wysyłkę robi `services/telemetria.js`.
 *
 * Zasada nazewnictwa: `obszar.czynnosc` (snake_case), np. `narzedzie.otwarte`.
 * Trzymanie nazw w jednym miejscu chroni przed dryfem („toolOpen" vs „narzedzie_otwarte"),
 * który psuje później zliczanie w dashboardzie.
 */

/** Znane zdarzenia. Klucz = stała używana w kodzie, wartość = nazwa wysyłana. */
export const ZDARZENIA = Object.freeze({
  APLIKACJA_START: 'aplikacja.start',
  EKRAN_OTWARTY: 'ekran.otwarty',
  NARZEDZIE_OTWARTE: 'narzedzie.otwarte',
  PRZETARG_OTWARTY: 'przetarg.otwarty',
  PRZETARG_ZAPISANY: 'przetarg.zapisany',
  POWIADOMIENIE_DOTKNIETE: 'powiadomienie.dotkniete',
  SUBSKRYPCJA_START: 'subskrypcja.start',
  BLAD_RENDEROWANIA: 'blad.renderowania',
});

const ZNANE = new Set(Object.values(ZDARZENIA));

/** Czy nazwa zdarzenia jest w katalogu (ochrona przed literówką/dryfem). */
export function znaneZdarzenie(nazwa) {
  return ZNANE.has(nazwa);
}

/**
 * Buduje znormalizowany rekord zdarzenia gotowy do wysłania.
 *
 * - Odrzuca nieznane nazwy (rzuca) — błąd łapiemy w testach, nie na produkcji.
 * - `props` obcinamy do wartości prostych (string/number/boolean); obiekty i funkcje
 *   pomijamy, żeby nie wysyłać przypadkiem danych wrażliwych ani nie-serializowalnych.
 * - `czasMs` wstrzykiwany (determinizm w testach; brak `Date.now()` w warstwie czystej).
 *
 * @param {string} nazwa jedna z wartości ZDARZENIA
 * @param {Record<string, unknown>} [props] atrybuty zdarzenia
 * @param {{czasMs?: number}} [opts]
 * @returns {{nazwa: string, props: Record<string, string|number|boolean>, czasMs: number|null}}
 */
export function zbudujZdarzenie(nazwa, props = {}, opts = {}) {
  if (!znaneZdarzenie(nazwa)) {
    throw new Error(`Nieznane zdarzenie analityczne: ${nazwa}`);
  }
  const czyste = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null) continue;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') czyste[k] = v;
  }
  return { nazwa, props: czyste, czasMs: opts.czasMs ?? null };
}
