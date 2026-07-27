import bazaKonkurencyjnosci from './bazaKonkurencyjnosci.js';
import platformaZakupowa from './platformaZakupowa.js';
import ezamawiajacy from './ezamawiajacy.js';
import epropublico from './epropublico.js';

/*
 * REJESTR adapterów źródeł podprogowych (ulepszenie „Radar zamówień podprogowych —
 * poniżej 170 tys. zł"). Jedno miejsce, po którym monitor (podzadanie 6/7) przeleci
 * tą samą ścieżką: dla każdej preferencji użytkownika (branża/region) uruchamia
 * KAŻDY adapter przez `zbierzIWepnij` (adapter → normalizacja → upsert z dedupem).
 *
 * Kolejność = kolejność wdrażania źródeł. Adaptery wieloinstancyjne (eZamawiający,
 * e-ProPublico) same pomijają się, dopóki nie dostaną z env swojego endpointu —
 * patrz nagłówki ich modułów.
 */
export const WSZYSTKIE_ADAPTERY = Object.freeze([
  bazaKonkurencyjnosci,
  platformaZakupowa,
  ezamawiajacy,
  epropublico,
]);

/** Adapter po identyfikatorze `zrodlo` (albo undefined). */
export function adapterPoZrodle(zrodlo) {
  return WSZYSTKIE_ADAPTERY.find((a) => a.zrodlo === zrodlo);
}

export default WSZYSTKIE_ADAPTERY;
