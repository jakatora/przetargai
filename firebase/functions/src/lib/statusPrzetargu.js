/**
 * Etap pracy nad zapisanym przetargiem (warsztat przetargu) — czysta logika.
 *
 * Wykonawca prowadzi kilka przetargów naraz; „Zapisane" bez etapu to martwa lista.
 * Etapy odwzorowują realny cykl: rozważam → przygotowuję ofertę → oferta złożona →
 * rozstrzygnięcie (wygrana/przegrana). Aktywne = wciąż w grze; zakończone = po sprawie.
 */

export const STATUSY = [
  { wartosc: 'rozwazam', etykieta: 'Rozważam', aktywny: true },
  { wartosc: 'przygotowuje', etykieta: 'Przygotowuję ofertę', aktywny: true },
  { wartosc: 'zlozona', etykieta: 'Oferta złożona', aktywny: true },
  { wartosc: 'wygrana', etykieta: 'Wygrana', aktywny: false },
  { wartosc: 'przegrana', etykieta: 'Przegrana', aktywny: false },
];

export const STATUS_DOMYSLNY = 'rozwazam';

const PRAWIDLOWE = new Set(STATUSY.map((s) => s.wartosc));

/** Nieznany/pusty status → domyślny. Nigdy nie ufamy wartości z zewnątrz. */
export function normalizujStatus(surowy) {
  return PRAWIDLOWE.has(surowy) ? surowy : STATUS_DOMYSLNY;
}

/** Podsumowanie tablicy zapisanych: licznik per etap + zbiorczo aktywne/zakończone. */
export function podsumujStatusy(zapisane) {
  const wynik = { rozwazam: 0, przygotowuje: 0, zlozona: 0, wygrana: 0, przegrana: 0, aktywne: 0, zakonczone: 0, razem: 0 };
  for (const z of zapisane) {
    const st = normalizujStatus(z?.status);
    wynik[st] += 1;
    wynik.razem += 1;
    if (st === 'wygrana' || st === 'przegrana') wynik.zakonczone += 1;
    else wynik.aktywne += 1;
  }
  return wynik;
}

/** Limit długości notatki — Firestore i tak przyjmie więcej, ale UI i koszt lubią granicę. */
const MAKS_NOTATKA = 2000;

/** Przycina białe znaki i długość. Pusta/nie-tekst → ''. */
export function oczyscNotatke(text) {
  return String(text ?? '').trim().slice(0, MAKS_NOTATKA);
}
