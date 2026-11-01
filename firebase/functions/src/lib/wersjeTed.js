/*
 * WERSJE OGŁOSZEŃ TED (2026-11-01). TED publikuje zmianę ogłoszenia (najczęściej przesunięty termin) jako NOWE
 * ogłoszenie konkursowe z tym samym `procedure-identifier` i polem `change-notice-version-identifier` — 30.10 było
 * to 139 z 250 polskich ogłoszeń konkursowych. Pobieranie zapisuje każdą wersję jako osobny dokument `ted:<numer>`:
 * 1.11 na prod 9421 dokumentów TED na 6795 postępowań, 2626 starych wersji, w 1537 postępowaniach różne terminy,
 * w 539 stara wersja wyglądała na zamkniętą, a aktualna przyjmowała oferty. Użytkownik widział przetarg dwa razy,
 * raz ze złym terminem. Aktualna wersja = najpóźniej opublikowana, przy tej samej dacie (TED podaje sam dzień)
 * — wyższy numer publikacji. CZYSTA logika; job: `jobs/wersjeTed.js`.
 */

/** „ted:752719-2026” → liczba rosnąca z kolejnością publikacji (rok, potem numer w roku). */
export function porzadekPublikacji(id) {
  const m = /(\d+)-(\d{4})$/.exec(String(id ?? ''));
  return m ? Number(m[2]) * 1e8 + Number(m[1]) : 0;
}

/** Najnowsza wersja z dokumentów jednego postępowania. */
export function aktualnaWersja(dokumenty) {
  let wynik = null;
  for (const d of dokumenty ?? []) {
    if (!d?.id) continue;
    if (!wynik) { wynik = d; continue; }
    const a = String(d.published_at ?? '').slice(0, 10);
    const b = String(wynik.published_at ?? '').slice(0, 10);
    if (a > b || (a === b && porzadekPublikacji(d.id) > porzadekPublikacji(wynik.id))) wynik = d;
  }
  return wynik;
}

/**
 * @param {{id: string, published_at?: string, deadline?: string, zastapiony_przez?: string|null}[]} dokumenty
 *   dokumenty TED jednego postępowania
 * @returns {{aktualna: object|null, starsze: object[]}} starsze = do oznaczenia (jeszcze nie wskazują aktualnej)
 */
export function wersjeDoZastapienia(dokumenty) {
  const aktualna = aktualnaWersja(dokumenty);
  if (!aktualna) return { aktualna: null, starsze: [] };
  const starsze = (dokumenty ?? []).filter((d) => d?.id && d.id !== aktualna.id && d.zastapiony_przez !== aktualna.id);
  return { aktualna, starsze };
}
