import { logger } from './logger.js';

/*
 * Tempo ruchu i ponawianie zapytań do publicznych API ogłoszeń.
 *
 * 🚨 NAJDROŻSZA WIEDZA W TYM PROJEKCIE. `403` to NIE jest „nasza wina": BZP dławi
 * ruch po ~9 szybkich zapytaniach (zmierzone w audycie 2026-09-23). Dopóki 403
 * wpadało do gałęzi „4xx nie ponawiamy", jedno dławienie zabierało CAŁĄ dobę
 * ogłoszeń — po cichu, bo błąd dnia był wyłącznie logowany. To najtańsze
 * wytłumaczenie okna 7-dniowego zakończonego na 1 330 ogłoszeniach zamiast ~5 000.
 *
 * Do 2026-09-24 ta logika była PRYWATNA w services/bzp.js, więc każde nowe źródło
 * musiałoby ją odkryć ponownie — na własnych, równie drogich danych. Mieszka tu,
 * żeby BZP, Baza Konkurencyjności i kolejne rejestry dzieliły JEDNĄ implementację.
 *
 * `spij` i `teraz` są wstrzykiwane w testach — inaczej zestaw testów spałby minutami.
 */

/** Kody, przy których ponawianie ma sens (403 = dławienie, nie trwały błąd). */
export const PONAWIALNE = new Set([403, 429, 500, 502, 503, 504]);

/** Ile razy próbujemy jedno zapytanie, zanim uznamy je za przegrane. */
export const PROBY = 3;

/** Odstęp po zwykłym błędzie (rośnie liniowo z numerem próby). */
export const ODSTEP_BAZOWY_MS = 1500;

/** Domyślny limit czasu jednego zapytania — bez niego żądanie wisi do końca funkcji. */
export const TIMEOUT_MS = 25_000;

/**
 * Domyślne tempo okna.
 *
 * Pomiar 2026-09-24 na żywym API BZP: doba = 1 011 ogłoszeń w 17 zapytaniach w ~14 s,
 * bez jednego 403. Sztywne 3,5 s odstępu (bezpieczna wartość z audytu) kosztowałoby
 * 7 × 17 × 3,5 s ≈ 416 s i samo w sobie wywracało budżet funkcji. Dlatego odstęp jest
 * ADAPTACYJNY: jedziemy szybko, a po pierwszym dławieniu zwalniamy na resztę okna.
 * Lepiej stracić minutę niż dobę ogłoszeń.
 */
export const TEMPO_DOMYSLNE = {
  odstepMs: 250,
  backoff403Ms: 20_000,
  mnoznikPo403: 8,
  maksOdstepMs: 4_000,
  spij: (ms) => new Promise((r) => setTimeout(r, ms)),
  teraz: () => Date.now(),
};

/** Stan tempa dla JEDNEGO okna — rośnie po trafieniu w throttling. */
export function stanTempa(tempo) {
  const t = { ...TEMPO_DOMYSLNE, ...tempo };
  return {
    ...t,
    biezacyOdstepMs: t.odstepMs,
    wykonane: 0,
    /** Odstęp PRZED kolejnym zapytaniem — pierwsze w oknie idzie od razu. */
    async przedZapytaniem() {
      if (this.wykonane > 0 && this.biezacyOdstepMs > 0) await this.spij(this.biezacyOdstepMs);
      this.wykonane += 1;
    },
    zwolnij() {
      this.biezacyOdstepMs = Math.min(this.maksOdstepMs, Math.max(1, this.biezacyOdstepMs) * this.mnoznikPo403);
    },
  };
}

/**
 * Pobiera adres z ponowieniem i rosnącym odstępem.
 *
 * Źródło bywa niedostępne przez chwilę. Bez ponowienia jednorazowa usterka sieci
 * oznaczała, że użytkownicy nie dostają TEGO DNIA żadnych nowych przetargów —
 * cykl uruchamia się raz na dobę (audyt 2026-07-10).
 *
 * Dławienie (403/429) ma WŁASNY, dłuższy backoff i trwale zwalnia tempo okna:
 * ponawianie co 1,5 s wchodzi drugi raz na tę samą minę.
 *
 * @param {URL|string} url
 * @param {object} tempo stan z `stanTempa` (wspólny dla całego okna)
 * @param {{zrodlo?: string, naglowki?: object, timeoutMs?: number}} [opcje]
 *   `zrodlo` trafia do logów — przy incydencie pierwsze pytanie brzmi „które API".
 * @returns {Promise<Response>} odpowiedź (także nie-ok, gdy ponawianie nie pomogło)
 */
export async function pobierzZPonowieniem(url, tempo, opcje = {}) {
  const {
    zrodlo = 'HTTP',
    naglowki = { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' },
    timeoutMs = TIMEOUT_MS,
  } = opcje;
  let ostatniBlad = null;

  for (let proba = 1; proba <= PROBY; proba++) {
    try {
      const res = await fetch(url, { headers: naglowki, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok || !PONAWIALNE.has(res.status) || proba === PROBY) return res;

      const dlawienie = res.status === 403 || res.status === 429;
      if (dlawienie) tempo.zwolnij();
      logger.warn({ zrodlo, status: res.status, proba, dlawienie, odstepMs: tempo.biezacyOdstepMs },
        `${zrodlo}: odpowiedź do ponowienia`);
      await tempo.spij(dlawienie ? tempo.backoff403Ms : ODSTEP_BAZOWY_MS * proba);
      continue;
    } catch (err) {
      ostatniBlad = err;
      if (proba === PROBY) break;
      logger.warn({ zrodlo, err: err.message, proba }, `${zrodlo}: błąd sieci, ponawiam`);
    }
    await tempo.spij(ODSTEP_BAZOWY_MS * proba);
  }

  throw ostatniBlad ?? new Error(`${zrodlo}: pobieranie nie powiodło się po ponowieniach`);
}
