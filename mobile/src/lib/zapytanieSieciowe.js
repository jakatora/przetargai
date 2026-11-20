/**
 * Wysyłka żądania z limitem czasu i ponowieniem odczytów.
 *
 * Dotąd `fetch` w kliencie API nie miał limitu: na słabym łączu (plac budowy, pociąg)
 * żądanie potrafiło wisieć bez końca, a ekran pokazywał spinner bez możliwości ponowienia.
 * Teraz po limicie żądanie jest przerywane i kończy się zwykłym błędem sieci (status 0),
 * który ekrany już obsługują komunikatem i przyciskiem „Spróbuj ponownie".
 *
 * Ponawiamy WYŁĄCZNIE odczyty (GET) i wyłącznie awarię sieci — nigdy odpowiedź HTTP
 * z błędem i nigdy zapis: powtórzony POST mógłby np. dwa razy utworzyć dokument w Sejfie.
 * Czyste i testowalne: `fetchFn` i `czekaj` są wstrzykiwane.
 */

export const LIMIT_ODCZYTU_MS = 20_000;
/** Zapisy dostają więcej czasu — Sejf wysyła pliki base64 do 10 MB. */
export const LIMIT_ZAPISU_MS = 60_000;
const PRZERWA_PRZED_PONOWIENIEM_MS = 800;

/** Limit i liczba ponowień dla metody HTTP. */
export function parametryDlaMetody(metoda) {
  return String(metoda).toUpperCase() === 'GET'
    ? { limitMs: LIMIT_ODCZYTU_MS, ponowienia: 1 }
    : { limitMs: LIMIT_ZAPISU_MS, ponowienia: 0 };
}

const domyslneCzekanie = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {object} opcje opcje `fetch` (bez `signal` — ten ustawiamy sami)
 * @param {{fetchFn?: Function, limitMs: number, ponowienia?: number, czekaj?: Function}} ust
 * @returns {Promise<Response>} odpowiedź (także z kodem błędu HTTP)
 * @throws błąd sieci albo przerwanie po limicie, gdy ponowienia się wyczerpią
 */
export async function wyslijZLimitem(url, opcje, { fetchFn = fetch, limitMs, ponowienia = 0, czekaj = domyslneCzekanie }) {
  for (let proba = 0; ; proba += 1) {
    const kontroler = new AbortController();
    let poLimicie = false;
    const zegar = setTimeout(() => { poLimicie = true; kontroler.abort(); }, limitMs);
    try {
      return await fetchFn(url, { ...opcje, signal: kontroler.signal });
    } catch (err) {
      // Przerwanie po NASZYM limicie czasu ≠ brak sieci — klient pokazuje inny komunikat (2026-11-10).
      if (proba >= ponowienia) throw poLimicie ? Object.assign(new Error('Przekroczono limit czasu'), { przekroczonoCzas: true }) : err;
    } finally {
      clearTimeout(zegar);
    }
    await czekaj(PRZERWA_PRZED_PONOWIENIEM_MS);
  }
}
