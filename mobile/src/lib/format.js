/** Formatowanie wartości do wyświetlenia (po polsku, bez zależności od Intl). */

const MONTHS = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

/** Data w formacie „18 maja 2026". */
export function formatDate(iso) {
  if (!iso) return 'brak danych';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'brak danych';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Liczba dni do podanej daty (ujemna = po terminie). */
export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Kwota z separatorem tysięcy, np. „1 250 000 PLN". */
export function formatBudget(amount, currency = 'PLN') {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return null;
  const grouped = Math.round(Number(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped} ${currency}`;
}
