/*
 * Komunikat o przerwie źródła w feedzie (2026-10-25). Przerwa techniczna e-Zamówienia
 * (23–25.10) oznaczała ZERO nowych ogłoszeń z BZP — użytkownik widział pusty feed i mógł
 * sądzić, że aplikacja przestała działać. Backend wie o tym (`/health` →
 * `cron.zrodla_cicho_puste`), więc zamiast ciszy mówimy wprost: to źródło ma przerwę,
 * ogłoszenia dociągną się po jej końcu. CZYSTA logika, nigdy nie rzuca.
 */

const NAZWY = Object.freeze({
  bzp: 'Biuletyn Zamówień Publicznych (e-Zamówienia)',
  ted: 'TED (ogłoszenia unijne)',
  baza_konkurencyjnosci: 'Baza Konkurencyjności',
});

/**
 * @param {object|null} health odpowiedź `GET /health`
 * @param {'pl'|'en'} [jezyk]
 * @returns {{pokaz: boolean, tekst: string, zrodla: string[]}}
 */
export function komunikatPrzerwyZrodel(health, jezyk = 'pl') {
  const lista = Array.isArray(health?.cron?.zrodla_cicho_puste) ? health.cron.zrodla_cicho_puste.filter((z) => typeof z === 'string') : [];
  if (!lista.length) return { pokaz: false, tekst: '', zrodla: [] };
  const nazwy = lista.map((z) => NAZWY[z] ?? z);
  const tekst = jezyk === 'en'
    ? `${nazwy.join(' and ')} returned no new notices today — the source is most likely under maintenance. Nothing is wrong with the app; new notices will load once it is back.`
    : `${nazwy.join(' i ')} nie opublikował${lista.length > 1 ? 'y' : ''} dziś żadnych nowych ogłoszeń — najpewniej przerwa techniczna po stronie źródła. To nie awaria aplikacji; nowe ogłoszenia dociągną się po jej końcu.`;
  return { pokaz: true, tekst, zrodla: lista };
}
