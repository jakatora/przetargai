/**
 * Filtr minimalnego procentu dopasowania w feedzie (życzenie usera 2026-07-10).
 *
 * Filtr działa PO STRONIE APLIKACJI na pobranych stronach: filtr serwerowy
 * wymagałby `where(score >=) + orderBy(created_at)`, czego Firestore zabrania
 * (nierówność musi być pierwszym sortowaniem), a backend i tak nie tworzy
 * dopasowań poniżej progu 60. Próg zapamiętywany na urządzeniu.
 */

export const PROGI = [
  { wartosc: 0, etykieta: 'Wszystkie' },
  { wartosc: 70, etykieta: '70%+' },
  { wartosc: 80, etykieta: '80%+' },
  { wartosc: 90, etykieta: '90%+' },
];

export const KLUCZ_PROGU = 'przetargai.minimalnyProcent';

/** Śmieci z magazynu (stara wersja, literówka) wracają do „Wszystkie". */
export function normalizujProg(surowy) {
  const liczba = Number(surowy);
  return PROGI.some((p) => p.wartosc === liczba) ? liczba : 0;
}

/**
 * @param {Array<{confidence_score?: number}>} dopasowania
 * @param {number} prog minimalny procent (0 = bez filtra)
 */
export function filtrujPoProgu(dopasowania, prog) {
  if (!prog) return dopasowania;
  return dopasowania.filter((m) => (m.confidence_score ?? 0) >= prog);
}
