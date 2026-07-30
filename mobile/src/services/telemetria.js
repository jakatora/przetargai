import { zbudujZdarzenie } from '../lib/zdarzenia';

/**
 * Cienka warstwa telemetrii: śledzenie zdarzeń i zgłaszanie błędów.
 *
 * Zaprojektowana jako PUNKT ZACZEPU pod Sentry/analitykę backendu, ale w pełni
 * samodzielna — działa bez żadnego zewnętrznego SDK. Wpięcie prawdziwego Sentry to
 * później jedna zmiana: zarejestrować `ustawUjscie(fn)` przekazujące zdarzenia do
 * `Sentry.captureMessage` / `Sentry.captureException` (natywny moduł wymaga przebudowy
 * EAS + DSN, więc świadomie nie dowiązujemy go tu na sztywno).
 *
 * ŻELAZNA zasada: telemetria NIGDY nie wywraca aplikacji. Każde wywołanie jest
 * best-effort i połyka własne wyjątki — analityka nie może być powodem awarii.
 */

let ujscie = null; // (rekord|blad) => void — podpinane przez ustawUjscie()

/** Rejestruje docelowe ujście telemetrii (np. Sentry albo POST na backend). */
export function ustawUjscie(fn) {
  ujscie = typeof fn === 'function' ? fn : null;
}

/** Bieżący znacznik czasu — wydzielony, by testy mogły go wstrzyknąć. */
function teraz() {
  try {
    return Date.now();
  } catch {
    return null;
  }
}

/**
 * Śledzi zdarzenie analityczne. Nazwa MUSI być z katalogu (`ZDARZENIA`) — nieznana
 * nazwa jest cicho ignorowana na produkcji (rzut z buildera łapiemy tu), żeby literówka
 * nie wygenerowała wyjątku u użytkownika.
 */
export function sledz(nazwa, props = {}) {
  try {
    const rekord = zbudujZdarzenie(nazwa, props, { czasMs: teraz() });
    if (ujscie) ujscie({ rodzaj: 'zdarzenie', ...rekord });
    else if (__DEV__) console.log('[telemetria]', rekord.nazwa, rekord.props);
  } catch {
    /* nieznane zdarzenie lub błąd ujścia — świadomie pomijamy */
  }
}

/**
 * Zgłasza błąd (wyjątek/awarię). Używane m.in. przez granicę błędu renderu.
 * @param {unknown} blad przechwycony wyjątek
 * @param {Record<string, unknown>} [kontekst] dodatkowe dane (np. ekran)
 */
export function zglosBlad(blad, kontekst = {}) {
  try {
    const rekord = {
      rodzaj: 'blad',
      komunikat: blad?.message ? String(blad.message) : String(blad),
      stos: typeof blad?.stack === 'string' ? blad.stack.slice(0, 2000) : null,
      kontekst,
      czasMs: teraz(),
    };
    if (ujscie) ujscie(rekord);
    else if (__DEV__) console.warn('[telemetria] błąd:', rekord.komunikat, kontekst);
  } catch {
    /* zgłoszenie błędu nie może samo wywrócić aplikacji */
  }
}
