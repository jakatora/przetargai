/** Reprezentacje zasobów bezpieczne do zwrotu w API (bez danych wrażliwych). */

/** Użytkownik bez hasła i identyfikatorów Stripe. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    company_nip: user.company_nip,
    company_name: user.company_name,
    premium_tier: user.premium_tier,
    keywords: user.keywords,
    cpv_codes: user.cpv_codes,
    created_at: user.created_at,
  };
}

/** Dopasowanie wraz z danymi przetargu (wiersz z JOIN-a w repos.matches). */
export function publicMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    confidence_score: row.confidence_score,
    reasoning: row.match_reasoning,
    scorer: row.scorer,
    created_at: row.created_at,
    tender: {
      id: row.tender_id,
      title: row.tender_title,
      organization: row.tender_organization,
      budget: row.tender_budget,
      currency: row.tender_currency,
      deadline: row.tender_deadline,
      url: row.tender_url,
      cpv: row.tender_cpv,
      source: row.tender_source ?? 'bzp',
    },
  };
}
