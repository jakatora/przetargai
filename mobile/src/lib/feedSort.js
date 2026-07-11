/**
 * Narzędzia pracy z feedem: sortowanie i wyszukiwanie tekstowe.
 * Działają PO STRONIE APLIKACJI na wczytanych dopasowaniach (jak filtr %),
 * bo to najczęstsze pytania wykonawcy: „co zamyka się najwcześniej" i
 * „znajdź ten konkretny przetarg".
 */

export const SORTOWANIA = [
  { wartosc: 'trafnosc', etykieta: 'Trafność' },
  { wartosc: 'termin', etykieta: 'Termin' },
  { wartosc: 'najnowsze', etykieta: 'Najnowsze' },
];

/** Klucz magazynu — wybór sortowania przeżywa restart aplikacji. */
export const KLUCZ_SORT = 'przetargai.sortFeedu';

export function normalizujSort(surowy) {
  return SORTOWANIA.some((s) => s.wartosc === surowy) ? surowy : 'trafnosc';
}

/** Bez ogonków i wielkości liter (ł/Ł mapujemy ręcznie — NFD ich nie rozkłada). */
function bezOgonkow(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/*
 * Lekki stemmer polskiej fleksji — żeby „sprzatanie" trafiało w „sprzątania".
 * Ta sama rodzina reguł co ściąga CPV i silnik dopasowań (świadomy duplikat:
 * osobne pakiety bez wspólnej biblioteki; przy zmianie zaktualizować wszystkie).
 */
const KONCOWKI = ['iami', 'ymi', 'ich', 'ych', 'ego', 'emu', 'ach', 'ami', 'ow', 'om', 'em', 'ie', 'ia', 'ej', 'ym', 'y', 'i', 'a', 'e', 'u', 'o'];
const MIN_RDZEN = 3;
const MIN_PREFIKS = 4;

function rdzen(slowo) {
  if (!slowo || slowo.length <= MIN_RDZEN) return slowo ?? '';
  for (const k of KONCOWKI) {
    if (slowo.endsWith(k) && slowo.length - k.length >= MIN_RDZEN) return slowo.slice(0, -k.length);
  }
  return slowo;
}

function rdzenie(tekst) {
  return bezOgonkow(tekst).split(/[^a-z0-9]+/).filter(Boolean).map(rdzen);
}

function trafia(rdzenSlowa, rdzenieTekstu) {
  if (rdzenSlowa.length >= MIN_PREFIKS) {
    // Kierunek odwrotny (rdzeń zapytania zaczyna się od rdzenia tekstu) TYLKO gdy
    // rdzeń tekstu też jest sensownej długości — inaczej „meble" trafiałoby
    // w jednoliterowe tokeny jak „w m. Białystok" (fałszywy trafień, QA 2026-07-11).
    return rdzenieTekstu.some((r) =>
      r.startsWith(rdzenSlowa) || (r.length >= MIN_PREFIKS && rdzenSlowa.startsWith(r)));
  }
  return rdzenieTekstu.includes(rdzenSlowa);
}

/**
 * Klucz sortowania po terminie: otwarte rosnąco wg terminu, potem bez terminu,
 * na końcu przetargi po terminie (najmniej istotne). Zwraca liczbę do porównania.
 */
function kluczTerminu(match, nowMs) {
  const d = match.tender?.deadline ? new Date(match.tender.deadline).getTime() : NaN;
  if (!Number.isFinite(d)) return Number.MAX_SAFE_INTEGER - 1; // bez terminu
  if (d < nowMs) return Number.MAX_SAFE_INTEGER;               // po terminie — na sam koniec
  return d;                                                     // otwarte — wg terminu
}

/**
 * @param {Array} matches
 * @param {'trafnosc'|'termin'|'najnowsze'} tryb
 * @param {string} nowIso „teraz" (wstrzykiwane w testach)
 * @returns {Array} NOWA, posortowana tablica (bez mutacji wejścia)
 */
export function sortujDopasowania(matches, tryb, nowIso = new Date().toISOString()) {
  const kopia = [...matches];
  const nowMs = new Date(nowIso).getTime();
  if (tryb === 'termin') {
    kopia.sort((a, b) => kluczTerminu(a, nowMs) - kluczTerminu(b, nowMs));
  } else if (tryb === 'najnowsze') {
    kopia.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  } else {
    kopia.sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0));
  }
  return kopia;
}

/**
 * Filtruje po tytule LUB nazwie zamawiającego. Puste zapytanie = całość.
 * Substring łapie fragmenty w środku słowa; rdzenie — odmiany fleksyjne
 * (każde słowo zapytania musi trafić w tytuł albo zamawiającego).
 */
export function filtrujTekst(matches, zapytanie) {
  const surowe = bezOgonkow(zapytanie).trim();
  if (!surowe) return matches;
  const rdzenieZapytania = rdzenie(zapytanie);

  return matches.filter((m) => {
    const tytul = bezOgonkow(m.tender?.title);
    const org = bezOgonkow(m.tender?.organization);
    if (tytul.includes(surowe) || org.includes(surowe)) return true;
    if (!rdzenieZapytania.length) return false;
    const rdzenieTekstu = [...rdzenie(m.tender?.title), ...rdzenie(m.tender?.organization)];
    return rdzenieZapytania.every((r) => trafia(r, rdzenieTekstu));
  });
}
