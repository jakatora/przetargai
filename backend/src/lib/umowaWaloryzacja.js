/**
 * Detektor KLAUZULI WALORYZACYJNEJ w projekcie umowy (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie", podzadanie 3/12).
 *
 * Wejściem jest znormalizowany tekst umowy (z `ekstrahuj_i_normalizuj`). Detektor
 * odpowiada „po ludzku": czy w umowie JEST klauzula waloryzacyjna — dla umów na
 * okres dłuższy niż 6 miesięcy obowiązkowa (art. 439 Pzp) — a jeśli tak, to jaki
 * ma PRÓG uruchomienia (o ile muszą zmienić się ceny/koszty) i LIMIT (górne
 * ograniczenie łącznej zmiany wynagrodzenia).
 *
 * To rozpoznawanie po FRAZACH/REGEX — świadomie proste i konserwatywne, nie
 * rozumienie prawnicze. Do dopasowania reużywamy `normalize` z textNorm (małe
 * litery, bez diakrytyków), żeby łapać warianty zapisu; oryginalne brzmienie
 * klauzuli nie jest tu potrzebne, bo `opis` budujemy z gotowych zdań.
 *
 * ZNANE OGRANICZENIE (dlatego to dopiero warstwa wstępna, a wyliczenie kwoty i
 * podstawa z art. 455 Pzp to osobne podzadania): próg/limit czytamy tylko z
 * OKNA wokół wzmianki o waloryzacji i odsiewamy % z kontekstu kar umownych,
 * zabezpieczenia, VAT-u itp. — mimo to złożone/nietypowe zapisy mogą wymagać
 * ręcznej weryfikacji, na co `opis` wprost zwraca uwagę. Konserwatywnie: przy
 * niejednoznaczności wolimy zwrócić `null` niż zmyśloną liczbę.
 */

import { normalize } from './textNorm.js';

// Wzmianki, które włączają klauzulę „na obecną" (wystarczy jedna). `art. 439`
// bywa cytowany bez słowa „waloryzacja", a i tak jednoznacznie o niej mówi.
const MARKERY = /waloryz\w*|indeksac\w*|art\.?\s*439/g;
const MA_KLAUZULE = /waloryz|indeksac|art\.?\s*439/;

// Liczba procentowa: „10%", „5,5 %", „15 procent". Grupa 1 = sama wartość.
const PROCENT = /(\d+(?:[.,]\d+)?)\s*(?:%|procent)/g;

// Podpowiedzi na OKNIE PRZED liczbą — rozróżniają LIMIT (górne ograniczenie)
// od PROGU (poziom uruchamiający). „nie przekroczy" świadomie jest po stronie
// limitu, więc gołe „przekrocz" (bez „nie") zostaje progiem.
const LIMIT_CUE = [
  'nie przekroczy', 'nie przekracza', 'nie moze przekrocz', 'nie wiecej niz',
  'maksymaln', 'gorna granic',
];
const PROG_CUE = [
  'o wiecej niz', 'wiecej niz', 'powyzej', 'ponad', 'przekrocz',
  'co najmniej', 'wzrost', 'poziom', 'prog', 'zmian',
];

// Konteksty, w których procent to NIE waloryzacja (kary umowne, zabezpieczenie,
// rękojmia, VAT, odsetki, zaliczka) — taki % pomijamy, choćby padł tuż obok.
const WYKLUCZ = [
  'kara', 'kary', 'kar umown', 'karami', 'za zwlok', 'za opoznien',
  'za kazdy dzien', 'za nieterminow', 'zabezpieczen', 'rekojm',
  'gwarancji nalezyt', 'vat', 'podatek', 'zaliczk', 'odsetk',
];

const OKNO_PRZED = 45; // znaków przed liczbą — tu szukamy cue (limit/próg)
const OKNO_PO = 30;    // znaków po liczbie — dołączane do wykrywania wykluczeń
const ZASIEG = 500;    // ile znaków od wzmianki o waloryzacji skanujemy pod %

const OPIS_BRAK = 'Nie wykryto klauzuli waloryzacyjnej. Dla umów na okres dłuższy '
  + 'niż 6 miesięcy jest ona obowiązkowa (art. 439 Pzp) — sprawdź, czy nie powinna '
  + 'się w umowie znaleźć.';

// Umowy DŁUŻSZE niż 6 miesięcy muszą zawierać klauzulę waloryzacyjną (art. 439 Pzp).
const PROG_MIESIACE = 6;

// Czerwona flaga zwracana w `ostrzezenie`, gdy umowa trwa dłużej niż 6 mies., a
// klauzuli brak. Zamrożona — to współdzielona, niezmienna stała (jeden i ten sam
// komunikat dla każdej analizy), więc nie może jej przypadkiem zmutować konsument.
const OSTRZEZENIE_BRAK_KLAUZULI = Object.freeze({
  poziom: 'czerwony',
  kod: 'brak_obowiazkowej_klauzuli',
  tytul: 'brak obowiązkowej klauzuli (Pzp)',
  opis: 'Szacowany czas trwania umowy przekracza 6 miesięcy, a nie wykryto '
    + 'klauzuli waloryzacyjnej. Dla takich umów jest ona obowiązkowa (art. 439 Pzp) '
    + '— brak klauzuli to istotna wada projektu umowy.',
});

/**
 * Czy zgłosić czerwoną flagę „brak obowiązkowej klauzuli". Tylko gdy klauzuli
 * BRAK i znany czas trwania przekracza 6 miesięcy. Nieznany/niepoprawny czas
 * (undefined, NaN, string, ≤0, Infinity) → `null`: konserwatywnie nie zgłaszamy
 * naruszenia, którego nie potrafimy potwierdzić. Obecna klauzula → obowiązek
 * spełniony, więc też `null`, niezależnie od czasu trwania.
 */
function ostrzezenieBrakuKlauzuli(obecna, miesiace) {
  if (obecna) return null;
  if (typeof miesiace !== 'number' || !Number.isFinite(miesiace)) return null;
  return miesiace > PROG_MIESIACE ? OSTRZEZENIE_BRAK_KLAUZULI : null;
}

/** Wartość procentowa do wyświetlenia po polsku (kropka dziesiętna → przecinek). */
function fmt(v) {
  return String(v).replace('.', ',');
}

/** Krótki opis „po ludzku", gdy klauzula jest obecna. */
function opisObecna(prog, limit) {
  const czesci = ['Wykryto klauzulę waloryzacyjną.'];
  czesci.push(prog != null
    ? `Waloryzacja uruchamia się, gdy ceny/koszty zmienią się o ponad ${fmt(prog)}%.`
    : 'Nie udało się jednoznacznie odczytać progu uruchomienia — zweryfikuj zapis ręcznie.');
  czesci.push(limit != null
    ? `Łączna zmiana wynagrodzenia jest ograniczona do ${fmt(limit)}%.`
    : 'W klauzuli nie wykryto górnego limitu waloryzacji — sprawdź, czy nie ogranicza wypłaty.');
  return czesci.join(' ');
}

/**
 * Wykrywa klauzulę waloryzacyjną w tekście umowy.
 * @param {string} tekst znormalizowany tekst umowy (surowy też zadziała)
 * @param {number} [miesiace] szacowany czas trwania umowy w miesiącach; gdy > 6
 *   a klauzuli brak, wynik niesie czerwoną flagę w `ostrzezenie`. Pominięty /
 *   niepoprawny => flagi nie zgłaszamy (nie znamy czasu trwania).
 * @returns {{ obecna: boolean, prog: number|null, limit: number|null, opis: string,
 *   ostrzezenie: {poziom: string, kod: string, tytul: string, opis: string}|null }}
 *   `prog`/`limit` to wartości procentowe (liczby), lub `null` gdy nieodczytane.
 *   `ostrzezenie` = czerwona flaga braku obowiązkowej klauzuli, albo `null`.
 */
export function wykryj_klauzule_waloryzacyjna(tekst, miesiace) {
  const t = normalize(tekst);
  if (!t || !MA_KLAUZULE.test(t)) {
    return {
      obecna: false, prog: null, limit: null, opis: OPIS_BRAK,
      ostrzezenie: ostrzezenieBrakuKlauzuli(false, miesiace),
    };
  }

  let prog = null;
  let limit = null;

  // Skanujemy TYLKO w zasięgu każdej wzmianki o waloryzacji — dzięki temu limit
  // kar umownych czy VAT spoza klauzuli nie zostaje wzięty za limit waloryzacji.
  for (const marker of t.matchAll(MARKERY)) {
    const scope = t.slice(marker.index, marker.index + ZASIEG);
    for (const m of scope.matchAll(PROCENT)) {
      const val = Number(m[1].replace(',', '.'));
      if (!(val > 0 && val <= 100)) continue; // odsiej nie-procenty / absurdy

      const before = scope.slice(Math.max(0, m.index - OKNO_PRZED), m.index);
      const around = scope.slice(Math.max(0, m.index - OKNO_PRZED), m.index + OKNO_PO);
      if (WYKLUCZ.some((c) => around.includes(c))) continue;

      // Każdy % klasyfikujemy RAZ i rozłącznie: limit ma pierwszeństwo („nie
      // przekroczy"), więc procent limitowy nigdy nie wycieknie do progu — nawet
      // gdy slot limitu jest już zajęty. Konserwatywnie: wolimy `null` niż pomyłkę.
      const jestLimit = LIMIT_CUE.some((c) => before.includes(c));
      const jestProg = !jestLimit && PROG_CUE.some((c) => before.includes(c));
      if (jestLimit && limit == null) limit = val;
      else if (jestProg && prog == null) prog = val;
    }
    if (prog != null && limit != null) break;
  }

  return {
    obecna: true, prog, limit, opis: opisObecna(prog, limit),
    ostrzezenie: ostrzezenieBrakuKlauzuli(true, miesiace),
  };
}
