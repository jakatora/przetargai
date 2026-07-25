/**
 * Detektor KAR UMOWNYCH w projekcie umowy (ulepszenie „pilnowanie waloryzacji
 * i pułapek w umowie", podzadanie 5/12).
 *
 * Wejściem jest znormalizowany tekst umowy (z `ekstrahuj_i_normalizuj`).
 * Detektor odpowiada „po ludzku": jakie kary umowne przewiduje umowa, jaka jest
 * suma ich stawek oraz — co najważniejsze — czy ich ŁĄCZNA wysokość jest
 * OGRANICZONA LIMITEM. Brak limitu to typowa pułapka: kary, zwłaszcza naliczane
 * „za każdy dzień" zwłoki, mogą narosnąć ponad wartość całej umowy. Dlatego przy
 * wykrytych karach bez limitu detektor zwraca CZERWONĄ flagę w polu `ostrzezenie`.
 *
 * To rozpoznawanie po FRAZACH/REGEX — świadomie proste i konserwatywne, nie
 * rozumienie prawnicze. Reużywamy `normalize` z textNorm (małe litery, bez
 * diakrytyków), żeby łapać warianty zapisu.
 *
 * ZNANE OGRANICZENIE: `suma` to prosta suma wykrytych STAWEK procentowych. Dla
 * kar dziennych („0,2% za każdy dzień") realna wartość rośnie z liczbą dni, więc
 * suma jest tylko orientacyjna — `opis` wprost o tym uprzedza. Konserwatywnie:
 * przy niejednoznaczności wolimy pominąć procent, niż policzyć go jako karę
 * (np. % waloryzacji, VAT-u czy zabezpieczenia NIE trafia na listę kar).
 */

import { normalize } from './textNorm.js';

// Liczba procentowa: „10%", „0,2 %", „12 procent". Grupa 1 = sama wartość.
const PROCENT = /(\d+(?:[.,]\d+)?)\s*(?:%|procent)/g;

// Żeby procent był KARĄ, w oknie przed nim musi paść słowo „kara" w którejś
// odmianie (po normalizacji ę→e, ą→a): kara, kary, karę, karą, kar (dopełniacz
// l. mn. — „łączna wysokość KAR umownych"), karom, karze, karami, karach.
// Kotwiczymy na granicy słowa, więc NIE łapiemy „karta", „karencja" ani
// „odpowiedzialność karna" (po „kar" idzie spółgłoska spoza listy końcówek).
const KARA_CUE = /\bkar(?:a|y|e|om|ze|ami|ach)?\b/;

// Podpowiedzi, że procent to LIMIT ŁĄCZNEJ wysokości kar (górne ograniczenie),
// a nie pojedyncza kara — wtedy nie liczymy go do sumy ani na listę.
const LIMIT_CUE = [
  'laczn', 'maksymaln', 'nie przekroczy', 'nie przekracza',
  'nie moze przekrocz', 'nie moga przekrocz', 'nie wiecej niz',
  'gorna granic', 'suma kar', 'sumie',
];

// Konteksty, w których procent to NIE kara umowna, choćby słowo „kara" padło
// gdzieś obok (waloryzacja, VAT/podatek, zabezpieczenie należytego wykonania,
// rękojmia/gwarancja, zaliczka, odsetki ustawowe, zmiana wynagrodzenia).
const WYKLUCZ = [
  'waloryz', 'indeksac', 'art.439', 'art. 439',
  'vat', 'podatek', 'zabezpieczen', 'rekojm', 'gwarancj',
  'zaliczk', 'odsetk', 'wzrost cen', 'zmiany cen', 'zmiana cen',
];

// Rozpoznanie TYPU kary i tego, czy jest naliczana „za każdy dzień".
const TYP_CUE = [
  [['odstapien', 'rozwiazani umowy'], 'za odstąpienie od umowy'],
  [['zwlok', 'opoznien', 'nieterminow'], 'za zwłokę / opóźnienie'],
  [['niewykonan', 'nienalezyt', 'nienalezyc'], 'za niewykonanie lub nienależyte wykonanie'],
  [['podwykonaw'], 'związana z podwykonawcami'],
];
const DZIENNIE_CUE = ['kazdy dzien', 'kazdego dnia', 'dziennie', 'kazdy rozpoczety dzien'];

const OKNO_PRZED = 90; // znaków przed liczbą — tu szukamy „kara" i cue limitu
const OKNO_PO = 40;    // znaków po liczbie — dołączane do wykrywania typu/wykluczeń

const OPIS_BRAK = 'Nie wykryto kar umownych w projekcie umowy. Sprawdź zapisy ręcznie '
  + '— kary bywają opisane w sposób nietypowy (np. kwotowo, nie procentowo).';

// Czerwona flaga: są kary, ale ich łączna wysokość NIE jest ograniczona limitem.
// Zamrożona — współdzielona, niezmienna stała (jeden komunikat dla każdej analizy).
const OSTRZEZENIE_BRAK_LIMITU = Object.freeze({
  poziom: 'czerwony',
  kod: 'brak_limitu_kar',
  tytul: 'kary umowne bez limitu',
  opis: 'Wykryto kary umowne, ale nie wykryto ograniczenia ich łącznej wysokości. '
    + 'Bez górnego limitu (np. „łączna wysokość kar nie przekroczy X% wynagrodzenia") '
    + 'kary — zwłaszcza naliczane za każdy dzień zwłoki — mogą narosnąć ponad wartość '
    + 'umowy. To istotna pułapka; warto żądać wprowadzenia limitu łącznej wysokości kar.',
});

/** Wartość procentowa do wyświetlenia po polsku (kropka dziesiętna → przecinek). */
function fmt(v) {
  return String(v).replace('.', ',');
}

/** Rozpoznaje typ kary z okna kontekstu (pierwsze dopasowanie wygrywa). */
function typKary(kontekst) {
  for (const [cues, etykieta] of TYP_CUE) {
    if (cues.some((c) => kontekst.includes(c))) return etykieta;
  }
  return 'kara umowna';
}

/** Krótki opis „po ludzku" na podstawie zebranych kar i limitu. */
function opisWyniku(kary, suma, limit, maDzienne) {
  if (kary.length === 0) {
    return limit != null
      ? `Nie wykryto pojedynczych kar umownych, ale łączna ich wysokość jest ograniczona `
        + `limitem ${fmt(limit)}%. Zweryfikuj zapisy ręcznie.`
      : OPIS_BRAK;
  }
  const czesci = [`Wykryto ${kary.length} ${kary.length === 1 ? 'karę umowną' : 'kary umowne'} `
    + `(suma wykrytych stawek: ${fmt(suma)}%).`];
  if (maDzienne) {
    czesci.push('Część kar jest naliczana za każdy dzień zwłoki — ich realna wartość '
      + 'rośnie z czasem, więc suma stawek jest tylko orientacyjna.');
  }
  czesci.push(limit != null
    ? `Łączna wysokość kar jest ograniczona limitem ${fmt(limit)}% wynagrodzenia.`
    : 'UWAGA: nie wykryto limitu łącznej wysokości kar — bez górnego ograniczenia kary '
      + 'mogą przekroczyć wartość umowy. Żądaj wprowadzenia limitu.');
  czesci.push('Zweryfikuj kwoty i podstawy naliczania ręcznie.');
  return czesci.join(' ');
}

/**
 * Wykrywa kary umowne w tekście umowy.
 * @param {string} tekst znormalizowany tekst umowy (surowy też zadziała)
 * @returns {{ kary: Array<{procent: number, typ: string, za_kazdy_dzien: boolean}>,
 *   suma: number, limit: number|null, czy_ograniczona_limitem: boolean, opis: string,
 *   ostrzezenie: {poziom: string, kod: string, tytul: string, opis: string}|null }}
 *   `suma` = suma stawek procentowych kar jednostkowych (orientacyjna). `limit` =
 *   wykryty limit łącznej wysokości kar (%), lub `null`. `ostrzezenie` = czerwona
 *   flaga braku limitu (gdy są kary, a limitu brak), albo `null`.
 */
export function wykryj_kary_umowne(tekst) {
  const t = normalize(tekst);
  const kary = [];
  let limit = null;

  if (t) {
    for (const m of t.matchAll(PROCENT)) {
      const val = Number(m[1].replace(',', '.'));
      if (!(val > 0 && val <= 100)) continue; // odsiej nie-procenty / absurdy

      const before = t.slice(Math.max(0, m.index - OKNO_PRZED), m.index);
      const around = t.slice(Math.max(0, m.index - OKNO_PRZED),
        m.index + m[0].length + OKNO_PO);

      // Musi być kontekst kary i NIE może być kontekstu wykluczonego. Wykluczenia
      // sprawdzamy tylko PRZED liczbą: rzeczownik nadający sens procentowi po
      // polsku poprzedza liczbę („VAT 23%", „waloryzacja … 15%", „zabezpieczenie
      // … 5%"). Gdyby patrzeć też ZA liczbą, limit kar (np. „…20% wynagrodzenia.
      // Klauzula waloryzacyjna…") zostałby błędnie odsiany przez sąsiednie zdanie.
      if (!KARA_CUE.test(before)) continue;
      if (WYKLUCZ.some((c) => before.includes(c))) continue;

      // Limit łącznej wysokości ma pierwszeństwo — nie liczymy go jako kary.
      if (LIMIT_CUE.some((c) => before.includes(c))) {
        if (limit == null) limit = val;
        continue;
      }

      kary.push({
        procent: val,
        typ: typKary(around),
        za_kazdy_dzien: DZIENNIE_CUE.some((c) => around.includes(c)),
      });
    }
  }

  const suma = Math.round(kary.reduce((s, k) => s + k.procent, 0) * 100) / 100;
  const czy_ograniczona_limitem = limit != null;
  const maDzienne = kary.some((k) => k.za_kazdy_dzien);
  // Czerwona flaga tylko gdy SĄ kary, a ich łączna wysokość nie ma limitu.
  const ostrzezenie = kary.length > 0 && !czy_ograniczona_limitem
    ? OSTRZEZENIE_BRAK_LIMITU
    : null;

  return {
    kary,
    suma,
    limit,
    czy_ograniczona_limitem,
    opis: opisWyniku(kary, suma, limit, maDzienne),
    ostrzezenie,
  };
}
