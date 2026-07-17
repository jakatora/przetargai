/**
 * Meta ogłoszenia wyciągane z `htmlBody` przy ingestii (rundy 5-6) — czysta logika.
 * Format zmierzony na żywo (2026-07-16), nie zgadywany.
 */

function czysty(htmlBody) {
  return String(htmlBody ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Kryterium oceny: czy wygrywa TYLKO najniższa cena, czy liczy się też jakość.
 * @returns {'tylko_cena'|'cena_i_jakosc'|null} null = nie dało się ustalić.
 */
export function parsujKryterium(htmlBody) {
  const t = czysty(htmlBody);
  const i = t.search(/Kryteria oceny ofert/i);
  if (i < 0) return null;
  const okno = t.slice(i, i + 600);
  // Jakość wygrywa nad ceną: gdy pada „jakościowe/jakości", to na pewno nie sama cena.
  if (/jako[śs]ci/i.test(okno)) return 'cena_i_jakosc';
  if (/najni[żz]sz[aą]\s+cen/i.test(okno)) return 'tylko_cena';
  return null;
}

/**
 * Liczba części zamówienia. Podział = mniejsze loty = dostępniejsze dla małej firmy.
 * @returns {number|null} liczba części (≥2 = podzielone, 1 = jawnie niepodzielone), null = nieznane.
 */
export function parsujCzesci(htmlBody) {
  const t = czysty(htmlBody);
  const m = t.match(/podzielone na\s+(\d+)\s*cz[eę][śs]/i);
  if (m) return Number(m[1]);
  // `\bnie\b` z granicą słowa — inaczej „zostaNIE podzielone" łapałoby się jak
  // „NIE podzielone" (słowo „zostanie" zawiera „nie”). Regresja złapana testem.
  if (/\bnie\s+(dopuszcza|przewiduje)\s+(sk[łl]adania\s+)?ofert\s+cz[eę][śs]ciowych/i.test(t)
    || /\bnie\s+(zosta[łl]o\s+)?podzielon[eo]\s+na\s+cz[eę][śs]ci/i.test(t)) {
    return 1;
  }
  return null;
}
