/**
 * INDEKS RADARU PLANÓW — czysta logika (bez Firestore, bez zegara).
 *
 * Po co indeks, a nie zapytanie do kolekcji `plany`: dopasowanie słów kluczowych
 * wymaga przejrzenia KAŻDEJ aktywnej pozycji (Firestore nie ma pełnotekstowego
 * wyszukiwania), a aktywnych planów jest ~2 500 rocznie (208 / 30 dni, zmierzone
 * 2026-09-24). Skan kolekcji przy każdym wejściu na ekran to 2 500 odczytów na
 * użytkownika. Indeks w kilku dokumentach po kilkaset wpisów to kilka odczytów —
 * a przebudowuje go job raz na dobę.
 */

/** Ile dni po przewidywanej dacie ogłoszenia pozycja jeszcze wisi w radarze. */
export const DNI_PO_TERMINIE = 60;

/**
 * Pozycja BEZ przewidywanej daty: WOI obowiązuje do 12 miesięcy od publikacji
 * (po tym czasie nie skraca już terminów), więc dłużej nie ma sensu jej trzymać.
 */
export const DNI_BEZ_TERMINU = 365;

/** Wpisów w jednym dokumencie indeksu — ~300 B na wpis, daleko od limitu 1 MiB. */
export const WPISOW_NA_CZESC = 400;

function dodajDni(iso, dni) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + dni * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Do kiedy (YYYY-MM-DD) pozycja jest aktywna w radarze. Null, gdy nie ma ani
 * terminu, ani daty publikacji — takiej pozycji nie da się umieścić na osi czasu.
 */
export function wygasaO(pozycja) {
  if (pozycja?.terminWszczecia) return dodajDni(pozycja.terminWszczecia, DNI_PO_TERMINIE);
  if (pozycja?.opublikowano) return dodajDni(pozycja.opublikowano, DNI_BEZ_TERMINU);
  return null;
}

/** Zwarty wpis indeksu — tylko pola potrzebne do rankingu i karty listy. */
export function wpisIndeksu(pozycja) {
  return {
    id: pozycja.id,
    przedmiot: pozycja.przedmiot,
    cpv: pozycja.cpv ?? [],
    region: pozycja.region ?? null,
    terminWszczecia: pozycja.terminWszczecia ?? null,
    wartosc: pozycja.wartosc ?? null,
    waluta: pozycja.waluta ?? null,
    zamawiajacy: pozycja.zamawiajacy ?? null,
    zamawiajacy_nip: pozycja.zamawiajacy_nip ?? null,
    rodzaj: pozycja.rodzaj ?? null,
    skraca_termin: Boolean(pozycja.skraca_termin),
    opublikowano: pozycja.opublikowano ?? null,
    wygasa_o: pozycja.wygasa_o ?? wygasaO(pozycja),
  };
}

/** Czy pozycja jest jeszcze aktywna w dniu `dzisiaj` (YYYY-MM-DD). */
export function jestAktywna(wpis, dzisiaj) {
  const wygasa = wpis?.wygasa_o ?? wygasaO(wpis);
  return Boolean(wygasa) && wygasa >= dzisiaj;
}

/** Tnie listę wpisów na części indeksu, zachowując kolejność. */
export function podzielNaCzesci(wpisy, rozmiar = WPISOW_NA_CZESC) {
  const czesci = [];
  for (let i = 0; i < wpisy.length; i += rozmiar) czesci.push(wpisy.slice(i, i + rozmiar));
  return czesci;
}
