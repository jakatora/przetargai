/*
 * Konfiguracja landingu PrzetargAI.
 * Lokalnie backend działa na http://localhost:3100.
 * Produkcja: Cloud Functions (D-043). Po podpięciu custom domain: https://api.przetargai.pl.
 * Lokalny dev: podmień na http://localhost:3100.
 */
window.PRZETARGAI = {
  API_URL: 'https://europe-central2-przetargai.cloudfunctions.net/api',
};
