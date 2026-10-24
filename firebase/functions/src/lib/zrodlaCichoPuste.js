/*
 * Źródło „cicho puste" (2026-10-24): e-Zamówienia miało przerwę techniczną i odpowiadało
 * 403 stroną HTML; 403 traktujemy jako dławienie (lib/tempoZapytan.js), więc cykl kończył
 * się `ok: true` z ZEREM surowych ogłoszeń z BZP i nikt tego nie widział przez dwa dni.
 * Zero surowych ogłoszeń z BZP albo TED w dzień roboczy nigdy nie jest prawdą (BZP
 * publikuje 400–1300 dziennie) — to awaria źródła albo naszego zapytania.
 * Wspólna reguła dla /health (flaga) i alarmu mailowego (jobs/alarmZrodla.js).
 */

/** Źródła, które w dzień roboczy publikują zawsze (BK bywa puste — pomijamy). */
const ZRODLA_CODZIENNE = ['bzp', 'ted'];

/** Dzień tygodnia w Polsce (0 = niedziela) dla znacznika ISO; null gdy brak/nieczytelny. */
function dzienTygodniaPL(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' })).getDay();
}

/**
 * Nazwy źródeł z ostatniego cyklu, które w dzień roboczy zwróciły zero SUROWYCH ogłoszeń
 * bez zgłoszonego błędu. Weekend i brak liczników per źródło (stary ślad) → pusta lista.
 */
export function zrodlaCichoPusteWCyklu(wynik, zakonczonoIso) {
  const dzien = dzienTygodniaPL(zakonczonoIso);
  if (dzien === null || dzien === 0 || dzien === 6) return [];
  const zrodla = wynik?.zrodla;
  if (!zrodla || typeof zrodla !== 'object') return [];
  return ZRODLA_CODZIENNE.filter((z) => {
    const s = zrodla[z];
    return s && typeof s === 'object' && s.surowe === 0 && (s.fetched ?? 0) === 0 && !s.error;
  });
}
