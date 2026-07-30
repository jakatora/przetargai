/**
 * Mapa: ładunek `data` z powiadomienia push → cel nawigacji w aplikacji.
 *
 * Czysta funkcja (bez React, bez nawigatora) — całą regułę „jaki typ pushu prowadzi
 * na jaki ekran" trzymamy tu, żeby dała się przetestować bez renderera. Warstwa
 * nawigacyjna (`navigation/nawigacjaRef.js`) tylko wykonuje zwrócony cel.
 *
 * Backend wysyła dziś dwa typy (patrz firebase/functions/src/services/matching.js
 * i jobs/remindDeadlines.js):
 *  • `new_matches`      → nowe dopasowane przetargi → lista „Twoje przetargi" (MatchFeed).
 *  • `deadline_reminder`→ zbliża się termin zapisanego przetargu → „Zapisane" (Saved).
 *
 * Push „deadline_reminder" niesie `tender_id`, ale NIE cały obiekt dopasowania —
 * ekran szczegółów wymaga pełnego `match` (z tenderem), więc kierujemy na listę
 * zapisanych, skąd użytkownik otwiera przetarg jednym dotknięciem (i skąd zresztą
 * pochodzą te przypomnienia). Nieznany/pusty typ → brak celu (samo zamknięcie pushu).
 *
 * @param {Record<string, unknown>|null|undefined} data ładunek `content.data` z powiadomienia
 * @returns {{ekran: string, params: Record<string, unknown>}|null} cel nawigacji albo null
 */
export function celPush(data) {
  if (!data || typeof data !== 'object') return null;

  switch (data.type) {
    case 'new_matches':
      return { ekran: 'MatchFeed', params: {} };
    case 'deadline_reminder':
      // Przekazujemy tender_id dalej — ekran „Zapisane" może go użyć do podświetlenia,
      // a brak obsługi nie szkodzi (zwykły parametr trasy).
      return {
        ekran: 'Saved',
        params: data.tender_id ? { podswietlTenderId: String(data.tender_id) } : {},
      };
    default:
      return null;
  }
}
