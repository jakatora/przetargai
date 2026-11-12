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

/**
 * Komunikat zastępczy, gdy serwer nie podał własnego (audyt 2026-11-10: „Błąd serwera (429).” nic
 * nie mówił pracownikowi na budowie — przy CGNAT wiele osób dzieli jedno IP i limit łapie się łatwo).
 */
function komunikatZastepczy(status) {
  if (status === 429) return 'Za dużo prób w krótkim czasie — odczekaj chwilę i spróbuj ponownie.';
  if (status === 413) return 'Plik jest za duży, żeby go wysłać.';
  if (status === 502 || status === 503 || status === 504) return `Serwer jest chwilowo niedostępny (${status}) — spróbuj za chwilę.`;
  return `Błąd serwera (${status}).`;
}

/** Błąd zbudowany z odpowiedzi serwera. */
export function bladOdpowiedzi(status, data) {
  const komunikat = data?.error?.message || komunikatZastepczy(status);
  return new ApiError(komunikat, status);
}

/** Żądanie nie dotarło do serwera (offline, DNS). */
export function bladSieci() {
  return new ApiError('Brak połączenia z serwerem. Sprawdź internet.', 0);
}

/**
 * Serwer nie odpowiedział w limicie czasu (audyt 2026-11-10). To NIE musi być brak internetu:
 * zapis albo pytanie do AI mogło się po stronie serwera wykonać — mówimy to wprost, żeby nikt
 * nie powtarzał w ciemno (powtórka zjada np. dzienny limit pytań do SWZ). Status 0 jak błąd sieci:
 * token zostaje, ekrany pokazują „Spróbuj ponownie”.
 */
export function bladCzasu() {
  const err = new ApiError('Serwer nie odpowiedział na czas. Sprawdź za chwilę, czy zmiana się zapisała, zanim spróbujesz ponownie.', 0);
  err.przekroczonoCzas = true;
  return err;
}
