/**
 * Obsługa kodów CPV (Common Procurement Vocabulary).
 *
 * BZP nie zwraca kodu — zwraca sklejony łańcuch wszystkich kodów z opisami:
 *   "45000000-7 (Roboty budowlane),45233222-1 (Roboty w zakresie układania chodników)"
 * 70,8% ogłoszeń ma więcej niż jeden kod. Kod główny nie zawsze jest tym,
 * który interesuje wykonawcę — chodniki bywają na trzeciej pozycji.
 *
 * Czyste funkcje, bez zależności. Testowalne w izolacji.
 */

/** Ósemka cyfr niepoprzedzona i nieprzedłużona cyfrą — sam kod, bez cyfry kontrolnej. */
const CODE = /(?<!\d)\d{8}(?!\d)/g;

/**
 * Wyciąga wszystkie 8-cyfrowe kody CPV z dowolnego wejścia BZP lub profilu firmy.
 * @param {string|string[]|null|undefined} input
 * @returns {string[]} kody bez cyfry kontrolnej, bez duplikatów, w kolejności wystąpienia
 */
export function parseCpvCodes(input) {
  if (!input) return [];
  const text = Array.isArray(input) ? input.join(',') : String(input);
  const found = text.match(CODE) ?? [];
  return [...new Set(found)];
}

/** Dwucyfrowe działy CPV (np. '45' = roboty budowlane), unikalne. */
export function cpvDivisions(codes) {
  return [...new Set(parseCpvCodes(codes).map((c) => c.slice(0, 2)))];
}

/**
 * Znaczący prefiks kodu firmy. Zera końcowe nie są cyframi — są deklaracją
 * szerokości: '45000000' znaczy "cała budowlanka", '45233000' znaczy
 * "roboty drogowe". Prefiks krótszy niż 2 znaki jest bezużyteczny.
 */
function significantPrefix(code) {
  const trimmed = code.replace(/0+$/, '');
  return trimmed.length >= 2 ? trimmed : '';
}

/**
 * Zgodność kodu firmy z kodem przetargu. Przetarg pasuje, gdy zaczyna się od
 * znaczącego prefiksu firmy; im dłuższy prefiks, tym węższa deklaracja i tym
 * pewniejsze dopasowanie.
 */
function pairAffinity(companyCode, tenderCode) {
  if (companyCode === tenderCode) return 1;
  const prefix = significantPrefix(companyCode);
  if (!prefix || !tenderCode.startsWith(prefix)) return 0;
  if (prefix.length >= 5) return 0.8;
  if (prefix.length >= 3) return 0.6;
  return 0.35;
}

/**
 * Najlepsza zgodność po WSZYSTKICH parach (kody firmy × kody przetargu).
 * Naprawia P-1: stara wersja porównywała prefiks wyłącznie z początkiem
 * sklejonego ciągu cyfr, więc widziała tylko pierwszy kod przetargu.
 * @returns {number} 0..1
 */
export function cpvAffinity(companyCodes, tenderCodes) {
  const mine = parseCpvCodes(companyCodes);
  const theirs = parseCpvCodes(tenderCodes);
  let best = 0;
  for (const a of mine) {
    for (const b of theirs) {
      const score = pairAffinity(a, b);
      if (score > best) best = score;
      if (best === 1) return 1;
    }
  }
  return best;
}
