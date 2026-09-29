/**
 * Harmonogram `remindDeadlines` (co 6 h): dwa NIEZALEŻNE przebiegi — przypomnienia
 * o terminie składania ofert i o terminie pytań do SWZ (review 2026-09-29).
 *
 * `Promise.allSettled`: wyjątek jednego przebiegu (np. brak indeksu, awaria
 * Firestore) nie blokuje drugiego. Wynik łączny ma `ok:false`, gdy którykolwiek
 * rzucił albo zgłosił błędy wpisów — handler w index.js rzuca wtedy wyjątek,
 * a Cloud Scheduler ponawia (oba przebiegi są idempotentne dzięki rezerwacjom).
 *
 * @param {{terminy?: () => Promise<object>, pytania?: () => Promise<object>}} [przebiegi]
 *   wstrzykiwane w testach; domyślnie prawdziwe joby
 */
export async function uruchomPrzypomnienia({ terminy, pytania } = {}) {
  const uruchomTerminy = terminy
    ?? (async () => (await import('./remindDeadlines.js')).runReminderCheck());
  const uruchomPytania = pytania
    ?? (async () => (await import('./przypomnieniaPytanSwz.js')).runPrzypomnieniaPytanSwz());

  const [t, p] = await Promise.allSettled([uruchomTerminy(), uruchomPytania()]);
  const opisz = (wynik) => (wynik.status === 'fulfilled'
    ? wynik.value
    : { ok: false, bledy: 1, blad: wynik.reason?.message ?? String(wynik.reason) });
  const wTerminy = opisz(t);
  const wPytania = opisz(p);

  return {
    ok: wTerminy.ok === true && wPytania.ok === true,
    bledy: (wTerminy.bledy ?? 0) + (wPytania.bledy ?? 0),
    terminy: wTerminy,
    pytania: wPytania,
  };
}
