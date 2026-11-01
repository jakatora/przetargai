/*
 * Czy błąd pobrania pliku jest PRZEJŚCIOWY (2026-11-01). Monitoring i job otwarcia rynku czytają każdy PDF raz
 * i znaczą go jako przeczytany — po błędzie przejściowym nie wolno, bo plik (informacja z otwarcia, wybór
 * oferty) przepadłby na zawsze. Przejściowe: dławienie e-Zamówień (403 — 1.11 po ~80 żądaniach), 429, 5xx,
 * limit czasu, zerwane połączenie. Trwałe: to nie PDF, za duży, niedozwolony adres, uszkodzony plik.
 */
const PRZEJSCIOWE = /HTTP (?:403|408|429|5\d\d)|odpowiedzia\S* (?:403|429|5\d\d)|timeout|timed out|abort|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network/i;

export function bladPrzejsciowy(err) {
  if (err?.przejsciowy === true) return true;
  return PRZEJSCIOWE.test(String(err?.message ?? err ?? '')) || err?.name === 'AbortError' || err?.name === 'TimeoutError';
}
