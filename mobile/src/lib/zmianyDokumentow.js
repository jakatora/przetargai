/*
 * Zmiany w dokumentacji przetargu na KARCIE LISTY (2026-11-01). Serwer co 2 h sprawdza pliki
 * w e-Zamówieniach (monitoring Zapisanych i czołówki feedu) i dokłada do przetargu oraz jego kopii
 * `ez_zmiany` = { wyjasnienia, zmiany, termin, ostatnia_o }. Karta mówi wprost, że jest co czytać —
 * bez otwierania przetargu i bez zaglądania na platformę.
 */

/** „Nowy termin · Zmiany SWZ (1) · Wyjaśnienia (2)” po polsku i angielsku; bez zmian — null. */
export function znacznikZmian(tender) {
  const z = tender?.ez_zmiany;
  if (!z || typeof z !== 'object') return null;
  const pl = [];
  const en = [];
  if (z.termin > 0) { pl.push('Nowy termin'); en.push('New deadline'); }
  if (z.zmiany > 0) { pl.push(`Zmiany SWZ (${z.zmiany})`); en.push(`Document changes (${z.zmiany})`); }
  if (z.wyjasnienia > 0) { pl.push(`Wyjaśnienia (${z.wyjasnienia})`); en.push(`Clarifications (${z.wyjasnienia})`); }
  return pl.length ? { pl: pl.join(' · '), en: en.join(' · ') } : null;
}
