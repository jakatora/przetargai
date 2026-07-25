/**
 * Detektor ZAPISÓW O ODBIORACH w projekcie umowy (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie", podzadanie 6/12).
 *
 * Wejściem jest znormalizowany tekst umowy (z `ekstrahuj_i_normalizuj`). Detektor
 * odpowiada „po ludzku": czy umowa reguluje ODBIORY (moment, w którym pracę uznaje
 * się za wykonaną i od którego zwykle biegnie zapłata i terminy), jakie ich rodzaje
 * przewiduje (końcowy, częściowy, ostateczny, pogwarancyjny, techniczny) oraz — co
 * najważniejsze — na jakie PUŁAPKI uważać. Klasyczna pułapka to odbiór warunkowany
 * BRAKIEM JAKICHKOLWIEK WAD/USTEREK: pozwala odmówić odbioru z powodu drobiazgu i
 * wstrzymać płatność. Przy jej wykryciu detektor zwraca flagę w polu `ostrzezenie`.
 *
 * To rozpoznawanie po FRAZACH/REGEX — świadomie proste i konserwatywne, nie
 * rozumienie prawnicze. Reużywamy `normalize` z textNorm (małe litery, bez
 * diakrytyków), żeby łapać warianty zapisu.
 *
 * DWUPOZIOMOWA SKALA FLAG (spójna z resztą ulepszenia): `czerwony` rezerwujemy na
 * naruszenia i pułapki niemal zawsze szkodliwe (np. brak limitu kar, brak
 * obowiązkowej klauzuli waloryzacyjnej). Odbiór warunkowany brakiem wad to
 * klauzula LEGALNA, lecz ryzykowna i zależna od kontekstu — stąd `pomarańczowy`.
 *
 * ZNANE OGRANICZENIE: cue typu/ryzyka szukamy tylko w OKNIE wokół wzmianki o
 * odbiorze, żeby ogólne frazy („bez wad") nie łapały się poza kontekstem (np. z
 * rękojmi). Rozpoznajemy formy rzeczownika „odbiór" (odbiór/odbioru/odbiory/…);
 * odmiany przymiotnikowe („odbiorczy") i rzeczownik „odbiorca" (adresat, NIE
 * odbiór) świadomie pomijamy. Nietypowe zapisy mogą wymagać ręcznej weryfikacji,
 * na co `opis` wprost zwraca uwagę.
 */

import { normalize } from './textNorm.js';

// Formy rzeczownika „odbiór" po normalizacji (ó→o). Jawne końcówki + granice słowa
// świadomie NIE łapią „odbiorca/odbiorcy" (adresat dostawy) ani przymiotnika
// „odbiorczy" — po „odbior" idzie tam „c", spoza listy końcówek. Globalny wariant
// (z /g) służy do matchAll, nie-globalny do szybkiego testu obecności.
const ODBIOR_G = /\bodbior(?:u|y|ow|em|ze|ie|owi|ami|ach)?\b/g;
const MA_ODBIORY = /\bodbior(?:u|y|ow|em|ze|ie|owi|ami|ach)?\b/;

// Rozpoznanie RODZAJU odbioru z okna kontekstu (rdzeń → etykieta po ludzku).
const RODZAJE_CUE = [
  ['koncow', 'odbiór końcowy'],
  ['czesciow', 'odbiór częściowy'],
  ['ostateczn', 'odbiór ostateczny'],
  ['pogwarancyjn', 'odbiór pogwarancyjny'],
  ['technicz', 'odbiór techniczny'],
];

// Pułapki/ryzyka w zapisach o odbiorze. `cues` szukamy w oknie wokół odbioru;
// `wymaga` (opcjonalne) to warunek dodatkowy sprawdzany w CAŁYM tekście — nota o
// płatności ma sens tylko, gdy umowa w ogóle wiąże zapłatę z odbiorem.
const RYZYKA = [
  {
    kod: 'odbior_bez_wad',
    cues: ['bez wad', 'wolny od wad', 'wolne od wad', 'wolnego od wad', 'bez usterek',
      'bez zastrzezen', 'nie stwierdzono wad'],
    nota: 'Odbiór (a przez to zapłata) jest warunkowany brakiem jakichkolwiek wad/usterek '
      + '— nawet drobna usterka pozwala odmówić odbioru i wstrzymać płatność.',
    flaga: true,
  },
  {
    kod: 'prawo_odmowy_odbioru',
    cues: ['odmowy odbioru', 'odmowa odbioru', 'odmowic odbioru', 'odmawia odbioru',
      'moze odmowic'],
    nota: 'Umowa daje Zamawiającemu prawo odmowy odbioru — sprawdź przesłanki, by nie '
      + 'było ono nadużywane do wstrzymywania płatności.',
    flaga: false,
  },
  {
    kod: 'platnosc_po_protokole',
    cues: ['protokol odbioru', 'protokolu odbioru', 'protokolem odbioru',
      'protokol koncowego odbioru', 'protokolu koncowego odbioru'],
    wymaga: ['platnosc', 'platnosci', 'faktur', 'wynagrodzenie', 'wynagrodzenia',
      'zaplat', 'rozliczen'],
    nota: 'Zapłata jest powiązana z podpisaniem protokołu odbioru — zwłoka w jego '
      + 'podpisaniu opóźnia płatność.',
    flaga: false,
  },
];

const OKNO = 140; // znaków przed i po wzmiance o odbiorze — tu szukamy cue

const OPIS_BRAK = 'Nie wykryto zapisów o odbiorach. To zapisy określające, kiedy praca '
  + 'zostaje uznana za wykonaną i od kiedy należy się zapłata — sprawdź, czy umowa ich '
  + 'nie pomija albo czy nie są ukryte pod nietypowymi sformułowaniami.';

// Pomarańczowa flaga: odbiór uzależniony od braku wad/usterek (ryzykowna, ale
// legalna klauzula). Zamrożona — współdzielona, niezmienna stała.
const OSTRZEZENIE_ODBIOR_BEZ_WAD = Object.freeze({
  poziom: 'pomarańczowy',
  kod: 'odbior_warunkowany_brakiem_wad',
  tytul: 'odbiór warunkowany brakiem wad',
  opis: 'Odbiór (a przez to zapłata) jest uzależniony od braku jakichkolwiek wad lub '
    + 'usterek. To częsta pułapka: nawet drobna usterka pozwala odmówić odbioru i '
    + 'wstrzymać płatność. Warto negocjować odbiór mimo wad nieistotnych, z terminem '
    + 'na ich usunięcie.',
});

/** Krótki opis „po ludzku", gdy zapisy o odbiorach są obecne. */
function opisObecne(rodzaje, ryzyka) {
  const czesci = [rodzaje.length
    ? `Wykryto zapisy o odbiorach (${rodzaje.join(', ')}).`
    : 'Wykryto zapisy o odbiorach.'];
  czesci.push('Odbiór przesądza, kiedy pracę uznaje się za wykonaną i od kiedy biegną '
    + 'terminy — zwykle uruchamia też zapłatę.');
  if (ryzyka.length) czesci.push('Na co uważać: ' + ryzyka.join(' '));
  czesci.push('Zweryfikuj zasady i terminy odbioru ręcznie.');
  return czesci.join(' ');
}

/**
 * Wykrywa i objaśnia zapisy o odbiorach w tekście umowy.
 * @param {string} tekst znormalizowany tekst umowy (surowy też zadziała)
 * @returns {{ obecne: boolean, rodzaje: string[], ryzyka: string[], opis: string,
 *   ostrzezenie: {poziom: string, kod: string, tytul: string, opis: string}|null }}
 *   `rodzaje` = wykryte rodzaje odbioru (etykiety po ludzku). `ryzyka` = krótkie
 *   noty o pułapkach wykrytych w zapisach. `ostrzezenie` = pomarańczowa flaga
 *   odbioru warunkowanego brakiem wad (gdy wykryta), albo `null`.
 */
export function wykryj_odbiory(tekst) {
  const t = normalize(tekst);
  if (!t || !MA_ODBIORY.test(t)) {
    return { obecne: false, rodzaje: [], ryzyka: [], opis: OPIS_BRAK, ostrzezenie: null };
  }

  // Okna wokół każdej wzmianki o odbiorze — cue rodzaju/ryzyka szukamy TYLKO tu,
  // żeby ogólne frazy („bez wad", „protokol") nie łapały się z innych klauzul.
  const okna = [];
  for (const m of t.matchAll(ODBIOR_G)) {
    okna.push(t.slice(Math.max(0, m.index - OKNO), m.index + m[0].length + OKNO));
  }
  const wOknie = (cue) => okna.some((w) => w.includes(cue));

  const rodzaje = [];
  for (const [cue, etykieta] of RODZAJE_CUE) {
    if (wOknie(cue) && !rodzaje.includes(etykieta)) rodzaje.push(etykieta);
  }

  const ryzyka = [];
  let ostrzezenie = null;
  for (const r of RYZYKA) {
    if (!r.cues.some(wOknie)) continue;
    if (r.wymaga && !r.wymaga.some((c) => t.includes(c))) continue;
    ryzyka.push(r.nota);
    if (r.flaga && !ostrzezenie) ostrzezenie = OSTRZEZENIE_ODBIOR_BEZ_WAD;
  }

  return { obecne: true, rodzaje, ryzyka, opis: opisObecne(rodzaje, ryzyka), ostrzezenie };
}
