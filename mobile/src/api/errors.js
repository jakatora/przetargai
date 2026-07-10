/**
 * Rozpoznawanie błędów API. Moduł celowo BEZ zależności od React Native —
 * dzięki temu da się go przetestować zwykłym `node --test` (mobile nie ma Jesta).
 *
 * Audyt 2026-07-09: klient nie odróżniał wygasłej sesji (401) od awarii serwera
 * ani od braku internetu. Skutki: wygasły token zawieszał apkę na ekranie błędu,
 * a odtwarzanie sesji przy starcie kasowało token przy KAŻDYM niepowodzeniu —
 * także offline. Rozróżnienie musi być jawne i jednoznaczne.
 */

export class ApiError extends Error {
  /**
   * @param {string} message komunikat dla użytkownika (po polsku)
   * @param {number} status kod HTTP; 0 oznacza brak odpowiedzi (błąd sieci)
   */
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    /** Sesja wygasła lub token jest nieważny — trzeba wylogować. */
    this.wygaslaSesja = status === 401;
    /** Żądanie nie doszło do serwera — token ZOSTAJE, to nie wina sesji. */
    this.bladSieci = status === 0;
  }
}

/** Błąd zbudowany z odpowiedzi serwera. */
export function bladOdpowiedzi(status, data) {
  const komunikat = data?.error?.message || `Błąd serwera (${status}).`;
  return new ApiError(komunikat, status);
}

/** Żądanie nie dotarło do serwera (offline, DNS, timeout). */
export function bladSieci() {
  return new ApiError('Brak połączenia z serwerem. Sprawdź internet.', 0);
}
