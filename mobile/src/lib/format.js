/** Formatowanie wartości do wyświetlenia (po polsku, bez zależności od Intl). */
import { chwilaUplywuTerminu, naDzienUTC, przesuniecieStrefyPL } from './dataUtc.js';

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

/**
 * Termin SKŁADANIA: zawsze zegar Europe/Warsaw, niezależnie od strefy telefonu.
 * API normalizuje sam dzień do 23:59:59.999 PL (daty.js/TED); BK zwraca też
 * 23:59:59 bez milisekund, choć publicznie podaje tylko dzień. Te znaczniki końca
 * dnia nie potwierdzają godziny. Rzeczywiste 00:00 oraz 23:59:00 pozostają widoczne.
 * Korzystamy z reguł CET/CEST dataUtc, działających również bez Intl w Hermes.
 */
export function formatDeadline(iso, timeZoneLabel = 'czas polski', source = null) {
  const termin = chwilaUplywuTerminu(iso);
  if (!termin) return 'brak danych';
  const d = new Date(termin.zGodzina
    ? termin.ms + przesuniecieStrefyPL(termin.ms)
    : naDzienUTC(iso));
  const data = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const koniecDnia = d.getUTCHours() === 23 && d.getUTCMinutes() === 59
    && d.getUTCSeconds() === 59 && (d.getUTCMilliseconds() === 999
      || (source === 'baza_konkurencyjnosci' && d.getUTCMilliseconds() === 0));
  if (!termin.zGodzina || koniecDnia) return data;
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${data}, ${hhmm} (${timeZoneLabel})`;
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
