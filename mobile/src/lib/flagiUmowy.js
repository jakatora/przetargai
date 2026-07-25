/**
 * Widok flag „prześwietlenia umowy przed podpisem" — CZYSTA logika, bez importów
 * z React Native, więc testowalna zwykłym `node --test` (mobile nie ma Jesta).
 *
 * Backend (`zbuduj_flagi_umowy`, backend/src/lib/umowaAnaliza.js) zwraca listę
 * `[{ typ, kolor, tytul, opis }]`, po jednej fladze na obszar umowy, z kolorem
 * ∈ { zielony, pomarańczowy, czerwony }. Tu tłumaczymy ten surowy kontrakt na to,
 * czego potrzebuje ekran: ludzką etykietę ryzyka, podsumowanie (ile zielonych /
 * uwag / czerwonych), ogólny poziom ryzyka umowy oraz uporządkowanie „najpierw
 * ryzyko" — wszystko odporne na nieznany/uszkodzony wpis (nie chowamy problemu,
 * nie udajemy zieleni).
 */

// Kolory z kontraktu backendu (`KOLOR` w lib/umowaAnaliza.js). Literały MUSZĄ
// zgadzać się co do znaku — w tym „ą" w „pomarańczowy" — bo backend przekazuje
// je żywcem; rozjazd literału rozspójniłby całą skalę.
export const KOLOR_ZIELONY = 'zielony';
export const KOLOR_POMARANCZOWY = 'pomarańczowy';
export const KOLOR_CZERWONY = 'czerwony';

/*
 * Metadane koloru: `etykieta` na plakietkę, `ryzyko` (klucz semantyczny) i `waga`
 * do sortowania „najpierw ryzyko" (0 = najgroźniejsze). Ekran dobiera do koloru
 * paletę (tło/tekst) po swojej stronie — tu trzymamy tylko czyste znaczenie.
 */
const META = {
  [KOLOR_CZERWONY]: { etykieta: 'Ryzyko', ryzyko: 'wysokie', waga: 0 },
  [KOLOR_POMARANCZOWY]: { etykieta: 'Uwaga', ryzyko: 'srednie', waga: 1 },
  [KOLOR_ZIELONY]: { etykieta: 'W porządku', ryzyko: 'brak', waga: 2 },
};

// Nieznany/uszkodzony kolor: traktujemy jak sprawę do ręcznego sprawdzenia
// (waga jak „uwaga" — między czerwonym a zielonym), nigdy jak zieleń.
const META_NIEZNANY = { etykieta: 'Do sprawdzenia', ryzyko: 'nieznane', waga: 1 };

/** Znaczenie koloru flagi (etykieta plakietki, poziom ryzyka, waga sortowania). */
export function meta_koloru(kolor) {
  return META[kolor] ?? META_NIEZNANY;
}

/** Czy wpis to w ogóle flaga (obiekt) — chroni przed null/stringiem w liście. */
function jestFlaga(f) {
  return Boolean(f) && typeof f === 'object';
}

/** Odsiewa śmieci: gwarantuje tablicę wyłącznie poprawnych flag. */
function tylkoFlagi(flagi) {
  return Array.isArray(flagi) ? flagi.filter(jestFlaga) : [];
}

/**
 * Zlicza flagi wg koloru. `ostrzezenia` = pomarańczowe + czerwone + nieznane,
 * czyli ile spraw wymaga uwagi przed podpisem (zielone są „ok").
 * @returns {{ razem, zielone, pomaranczowe, czerwone, inne, ostrzezenia }}
 */
export function podsumuj_flagi(flagi) {
  const lista = tylkoFlagi(flagi);
  let zielone = 0;
  let pomaranczowe = 0;
  let czerwone = 0;
  let inne = 0;
  for (const f of lista) {
    if (f.kolor === KOLOR_ZIELONY) zielone += 1;
    else if (f.kolor === KOLOR_POMARANCZOWY) pomaranczowe += 1;
    else if (f.kolor === KOLOR_CZERWONY) czerwone += 1;
    else inne += 1;
  }
  return {
    razem: lista.length,
    zielone,
    pomaranczowe,
    czerwone,
    inne,
    ostrzezenia: pomaranczowe + czerwone + inne,
  };
}

/**
 * Ogólny poziom ryzyka umowy — z najgroźniejszej flagi:
 *   czerwona → 'wysokie', pomarańczowa/nieznana → 'srednie',
 *   same zielone → 'niskie', brak flag → 'brak'.
 */
export function ryzyko_ogolne(flagi) {
  const p = podsumuj_flagi(flagi);
  if (p.razem === 0) return 'brak';
  if (p.czerwone > 0) return 'wysokie';
  if (p.pomaranczowe > 0 || p.inne > 0) return 'srednie';
  return 'niskie';
}

/**
 * Porządkuje flagi „najpierw ryzyko": czerwone → pomarańczowe/nieznane → zielone.
 * Sort jest STABILNY — w obrębie tej samej wagi zachowuje kolejność z backendu
 * (waloryzacja / kary / odbiory / podwykonawcy). Uszkodzone wpisy odpadają.
 * Nie mutuje wejścia.
 */
export function porzadkuj_ryzykiem(flagi) {
  return tylkoFlagi(flagi)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (meta_koloru(a.f.kolor).waga - meta_koloru(b.f.kolor).waga) || (a.i - b.i))
    .map(({ f }) => f);
}
