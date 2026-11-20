import { logger } from './logger.js';

const PONAWIALNE = new Set([429, 500, 502, 503, 504]);
const PROBY = 3;
const TIMEOUT_MS = 25_000;
const BUDZET_MS = 120_000;

/** Retry-After może być liczbą sekund albo datą HTTP. Nie skracamy go. */
function czasPonowienia(naglowek, teraz) {
  if (typeof naglowek !== 'string' || !naglowek.trim()) return null;
  const wartosc = naglowek.trim();
  if (/^\d+(?:\.\d+)?$/.test(wartosc)) {
    const ms = Number(wartosc) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  const data = Date.parse(wartosc);
  return Number.isFinite(data) ? Math.max(0, data - teraz) : null;
}

/**
 * Klient jednego importu TED. Ponawia WYŁĄCZNIE odczyt /notices/search;
 * limit dotyczy całego importu, nie każdej strony osobno. Po trwałym błędzie
 * oddaje ostatnią odpowiedź, aby adapter nadal zgłosił awarię zamiast pustego feedu.
 * Zegar i przerwy wstrzykujemy do testów bez prawdziwego czekania.
 */
export function utworzKlientaTed({
  fetchFn = fetch,
  spij = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  teraz = () => Date.now(),
  budzetMs = BUDZET_MS,
  odstepMs = 300,
  licznik,
} = {}) {
  const koniec = teraz() + Math.min(BUDZET_MS, Math.max(0, budzetMs));
  let wykonane = 0;
  let odstep = odstepMs;

  async function przerwa(ms) {
    if (ms >= koniec - teraz()) throw new Error('TED: wyczerpany budżet czasu pobierania');
    if (ms > 0) await spij(ms);
  }

  return async (url, opcje) => {
    if (wykonane > 0) await przerwa(odstep);
    for (let proba = 1; proba <= PROBY; proba++) {
      const zostalo = koniec - teraz();
      if (zostalo <= 0) throw new Error('TED: wyczerpany budżet czasu pobierania');
      const timeout = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(TIMEOUT_MS, zostalo))));
      const signal = opcje.signal ? AbortSignal.any([opcje.signal, timeout]) : timeout;
      wykonane++;
      if (licznik) licznik.zapytania++;
      let odpowiedz;
      try {
        odpowiedz = await fetchFn(url, { ...opcje, signal });
      } catch (err) {
        if (proba === PROBY || opcje.signal?.aborted) throw err;
        logger.warn({ proba, err: err.message }, 'TED: przejściowy błąd sieci, ponawiam odczyt');
        await przerwa(1500 * proba);
        continue;
      }
      if (odpowiedz.ok || !PONAWIALNE.has(odpowiedz.status) || proba === PROBY) return odpowiedz;

      const dlawienie = odpowiedz.status === 429;
      const retryAfter = czasPonowienia(odpowiedz.headers?.get?.('retry-after'), teraz());
      const czekajMs = Math.max(retryAfter ?? 0, (dlawienie ? 20_000 : 1500) * proba);
      // Długie Retry-After nie uprawnia do wcześniejszego ponowienia. Oddajemy
      // błąd, zamiast blokować inne źródła albo przekraczać timeout funkcji.
      if (czekajMs >= koniec - teraz()) return odpowiedz;
      if (dlawienie) odstep = Math.min(4000, Math.max(300, odstep) * 8);
      await odpowiedz.body?.cancel?.().catch(() => {});
      logger.warn({ status: odpowiedz.status, proba, czekajMs }, 'TED: ponawiam odczyt po przerwie');
      await przerwa(czekajMs);
    }
  };
}
