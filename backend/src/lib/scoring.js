/**
 * Heurystyczny scoring dopasowania przetargu do profilu firmy.
 * Czysta funkcja — używana jako pre-filtr przed AI oraz jako fallback,
 * gdy AI jest niedostępne. Testowalna w izolacji.
 */

/** Normalizuje tekst do porównań: małe litery, bez nadmiarowych spacji. */
function norm(text) {
  return String(text ?? '').toLowerCase();
}

/**
 * Zwraca wynik 0–100 oraz listę trafionych słów kluczowych.
 * @param {{keywords: string[], cpv_codes: string[]}} company
 * @param {{title: string, organization?: string, cpv_main?: string, cpvMain?: string}} tender
 */
export function heuristicScore(company, tender) {
  const keywords = (company.keywords ?? []).map(norm).filter(Boolean);
  const cpvCodes = (company.cpv_codes ?? []).map((c) => String(c ?? ''));
  const haystack = `${norm(tender.title)} ${norm(tender.organization)}`;

  const matchedKeywords = keywords.filter((kw) => haystack.includes(kw));

  let score = keywords.length
    ? Math.round((matchedKeywords.length / keywords.length) * 100)
    : 0;

  // Premia za zgodność kodu CPV. Prefiks firmy (po obcięciu zer końcowych)
  // wyznacza szerokość zainteresowania: '45000000' => '45' (cała budowlanka),
  // '45300000' => '453' (węższa kategoria). Przetarg pasuje, gdy zaczyna się
  // od tego prefiksu.
  const tenderDigits = String(tender.cpv_main ?? tender.cpvMain ?? '').replace(/\D/g, '');
  let cpvMatched = false;
  if (tenderDigits && cpvCodes.length) {
    cpvMatched = cpvCodes.some((code) => {
      const prefix = String(code).replace(/\D/g, '').replace(/0+$/, '');
      return prefix.length >= 2 && tenderDigits.startsWith(prefix);
    });
    if (cpvMatched) score = Math.min(100, score + 30);
  }

  return { score: Math.max(0, Math.min(100, score)), matchedKeywords, cpvMatched };
}
