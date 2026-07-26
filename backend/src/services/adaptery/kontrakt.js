/**
 * WSPÓLNY KONTRAKT adaptera źródła podprogowego (ulepszenie „Radar zamówień
 * podprogowych — poniżej 170 tys. zł", podzadanie 3/7).
 *
 * Każde źródło rozproszonych ogłoszeń (Baza Konkurencyjności, platformazakupowa.pl,
 * eZamawiający „postępowania wyłączone z Pzp", e-propublico, BIP-y) dostaje adapter
 * o JEDNYM interfejsie:
 *
 *     pobierz(branza, region) -> Promise<surowe[]>
 *
 * gdzie `surowe[]` to lista ogłoszeń w „luźnym" kształcie akceptowanym przez czystą
 * funkcję `normalizujPodprogowe` (podzadanie 2/7). Adapter zajmuje się WYŁĄCZNIE
 * transportem i spłaszczeniem odpowiedzi swojego źródła do tego kształtu — progu,
 * dedupu, dopasowania branży/regionu i flag „łatwiejszego startu" NIE liczy (to
 * robi normalizacja). Dzięki temu monitor (podzadanie 6/7) może przelecieć po
 * wszystkich adapterach tą samą ścieżką: adapter → normalizacja → upsert.
 *
 * @typedef {Object} SuroweOgloszenie luźny rekord (klucze mapowane w normalizacji)
 * @property {string}  zrodlo          identyfikator źródła (CHECK migracji 009)
 * @property {string} [id_zewnetrzny]  identyfikator ogłoszenia u źródła
 * @property {string} [tytul]
 * @property {string} [zamawiajacy]
 * @property {number|string} [wartosc_netto]
 * @property {string} [termin_skladania]
 * @property {string} [link]
 * @property {string} [region]
 * @property {string} [branza]
 * @property {string} [opis]
 *
 * @typedef {Object} AdapterZrodla
 * @property {string} zrodlo  identyfikator źródła (spójny z CHECK migracji 009)
 * @property {(branza?: string, region?: string, opts?: object) => Promise<SuroweOgloszenie[]>} pobierz
 */

/** Źródła dozwolone przez CHECK w migracji 009 (spójność z bazą/normalizacją). */
export const ZRODLA = Object.freeze([
  'bzp_wylaczone', 'platformazakupowa', 'ezamawiajacy', 'epropublico',
  'baza_konkurencyjnosci', 'bip',
]);

/**
 * Tworzy adapter o wspólnym kontrakcie, walidując jego kształt. Zwrócony obiekt
 * jest zamrożony — monitor traktuje adaptery jako niezmienne wtyczki.
 * @param {{zrodlo: string, pobierz: Function}} def
 * @returns {AdapterZrodla}
 */
export function utworzAdapter({ zrodlo, pobierz } = {}) {
  if (!zrodlo || typeof zrodlo !== 'string') {
    throw new TypeError('adapter: `zrodlo` musi być niepustym stringiem');
  }
  if (typeof pobierz !== 'function') {
    throw new TypeError('adapter: `pobierz` musi być funkcją (branza, region) -> Promise<surowe[]>');
  }
  return Object.freeze({ zrodlo, pobierz });
}
