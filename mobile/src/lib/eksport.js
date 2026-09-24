/**
 * EKSPORT CSV (P2-3) — teksty ekranu, czysta logika (zero React Native, zero sieci).
 *
 * Plik idzie jako ZAŁĄCZNIK na adres właściciela konta: aplikacja nie ma modułów
 * natywnych do zapisu pliku, a firma i tak otwiera eksport na komputerze w Excelu.
 */

import { tr } from './jezyk.js';

function odmianaPozycji(n) {
  if (n === 1) return 'pozycją';
  return 'pozycjami';
}

/** Treść okna potwierdzenia: co wyślemy i na jaki adres. */
export function potwierdzenieEksportu(rodzaj, email, jezyk = 'pl') {
  const dokad = email ?? tr({ pl: 'Twój adres e-mail', en: 'your e-mail address' }, jezyk);
  if (rodzaj === 'kalendarz') {
    return tr({
      pl: `Wyślemy terminy zapisanych przetargów jako plik kalendarza (.ics) na ${dokad}.`,
      en: `We will send the deadlines of your saved tenders as a calendar file (.ics) to ${dokad}.`,
    }, jezyk);
  }
  const co = rodzaj === 'zapisane'
    ? { pl: 'listę zapisanych przetargów', en: 'your saved tenders' }
    : { pl: 'przetargi z katalogu (z bieżącymi filtrami, najwyżej 500)', en: 'tenders from the catalogue (current filters, up to 500)' };
  return tr({
    pl: `Wyślemy ${co.pl} jako plik CSV (do Excela) na ${dokad}.`,
    en: `We will send ${co.en} as a CSV file (for Excel) to ${dokad}.`,
  }, jezyk);
}

export function komunikatWyniku(odp, jezyk = 'pl') {
  if (!odp?.wyslano) {
    return tr({
      pl: 'Wysyłka e-maili jest chwilowo niedostępna — spróbuj później.',
      en: 'E-mail delivery is temporarily unavailable — try again later.',
    }, jezyk);
  }
  const n = odp.wierszy ?? 0;
  if (odp.rodzaj === 'kalendarz') {
    return tr({
      pl: `Wysłaliśmy terminy (${n} ${n === 1 ? 'postępowanie' : 'postępowań'}) na ${odp.do}. Dotknij załącznika w poczcie, żeby dodać je do kalendarza.`,
      en: `We sent the deadlines (${n} procedure${n === 1 ? '' : 's'}) to ${odp.do}. Tap the attachment in your mail to add them to your calendar.`,
    }, jezyk);
  }
  let tekst = tr({
    pl: `Wysłaliśmy plik z ${n} ${odmianaPozycji(n)} na ${odp.do}. Otwórz go w Excelu dwuklikiem.`,
    en: `We sent a file with ${n} row${n === 1 ? '' : 's'} to ${odp.do}. Open it in Excel with a double click.`,
  }, jezyk);
  if (odp.obciety) {
    tekst += tr({
      pl: ' To pierwsze 500 pozycji — zawęź filtry, żeby dostać resztę.',
      en: ' These are the first 500 rows — narrow the filters to get the rest.',
    }, jezyk);
  }
  return tekst;
}

export function komunikatBledu(err, jezyk = 'pl') {
  if (err?.status === 0) {
    return tr({ pl: 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.', en: 'No connection to the server. Check the internet and try again.' }, jezyk);
  }
  return err?.message ?? tr({ pl: 'Nie udało się wysłać eksportu.', en: 'Could not send the export.' }, jezyk);
}
