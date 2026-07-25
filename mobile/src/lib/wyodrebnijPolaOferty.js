/**
 * Parser dokumentów oferty zwycięzcy — podzadanie 8/13 ulepszenia „Prześwietlenie
 * oferty zwycięzcy i szansa na odwołanie".
 *
 * WYŁĄCZNIE ekstrakcja pól z TEKSTU dokumentu (warstwa tekstowa PDF albo wynik
 * OCR): cena, format podpisu, lista oświadczeń, zaświadczenia + daty. Zwraca
 * czysty dict — bez UI, bez oceny przesłanek odrzucenia (to kolejne podzadania:
 * rażąco niska cena, brak oświadczeń, nieaktualne zaświadczenia). Deterministyczna
 * i defensywna: nigdy nie rzuca, przy braku danych zwraca pełny kształt z pustymi
 * polami (null / []).
 *
 * ROZDZIAŁ ODPOWIEDZIALNOŚCI: samo zamienianie bajtów PDF na tekst oraz OCR skanu
 * to osobny krok integracyjny (native / warstwa tekstowa runtime), poza tą czystą
 * funkcją — dlatego `plik` niesie już tekst. Dzięki temu logikę ekstrakcji da się
 * przetestować jednostkowo w node:test, spójnie z resztą czystych funkcji lib.
 */

/** Trzy prawne formy podpisu elektronicznego w zamówieniach publicznych (art. 63 Pzp). */
export const RODZAJE_PODPISU = ['kwalifikowany', 'zaufany', 'osobisty'];

/** Etykieta na fallback, gdy w tekście nie rozpoznano formy podpisu. */
export const PODPIS_NIEOKRESLONY = 'nieokreslony';

// Znak litery wyrazu Z polskimi diakrytykami. `\w` (ASCII) nie obejmuje ą/ć/ę/ł/
// ń/ó/ś/ź/ż, więc `warunk\w*` urwałoby się przed „ów" w „warunków" — wzorce
// odmienionych wyrazów muszą używać tej klasy, nie samego `\w`.
const L = '[\\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]';
/** Buduje wzorzec case-insensitive z fragmentu, w którym `%` oznacza „ogon wyrazu" ({@link L}*). */
const wz = (zrodlo) => new RegExp(zrodlo.replace(/%/g, `${L}*`), 'i');

/**
 * Katalog oświadczeń typowo wymaganych od wykonawcy. `wzorce` = wyrażenia szukane
 * w tekście (case-insensitive). Kolejność jest kontraktem — wynik zachowuje ten
 * porządek niezależnie od układu w dokumencie (determinizm dla podzadań analizy).
 */
export const KATALOG_OSWIADCZEN = [
  {
    rodzaj: 'niepodleganie_wykluczeniu',
    etykieta: 'Oświadczenie o niepodleganiu wykluczeniu',
    wzorce: [/niepodleganiu?\s+wykluczeniu/i, wz('brak%\\s+podstaw%\\s+do\\s+wykluczenia')],
  },
  {
    rodzaj: 'spelnianie_warunkow',
    etykieta: 'Oświadczenie o spełnianiu warunków udziału',
    wzorce: [wz('spe[łl]niani%\\s+warunk%\\s+udzia[łl]u')],
  },
  {
    rodzaj: 'jedz',
    etykieta: 'JEDZ (jednolity europejski dokument zamówienia)',
    wzorce: [/\bJEDZ\b/i, wz('jednolit%\\s+europejsk%\\s+dokument'), /\bESPD\b/i],
  },
  {
    rodzaj: 'grupa_kapitalowa',
    etykieta: 'Oświadczenie o przynależności do grupy kapitałowej',
    wzorce: [wz('grup%\\s+kapita[łl]ow%')],
  },
  {
    rodzaj: 'aktualnosc',
    etykieta: 'Oświadczenie o aktualności informacji',
    wzorce: [/o\s+aktualno[śs]ci/i],
  },
];

/**
 * Katalog zaświadczeń/dokumentów podmiotowych + wzorce ich rozpoznania. `rodzaj`
 * to zwięzły skrót instytucji (ZUS, US, KRK, KRS, CEIDG). Kolejność jak wyżej —
 * kontrakt dla analizy „nieaktualne zaświadczenie".
 */
export const KATALOG_ZASWIADCZEN = [
  {
    rodzaj: 'ZUS',
    etykieta: 'Zaświadczenie ZUS (niezaleganie ze składkami)',
    wzorce: [/\bZUS\b/, wz('zak[łl]ad%\\s+ubezpiecze[ńn]%\\s+spo[łl]eczn%')],
  },
  {
    rodzaj: 'US',
    etykieta: 'Zaświadczenie z urzędu skarbowego (niezaleganie w podatkach)',
    wzorce: [wz('urz[ęe]d%\\s+skarbow%')],
  },
  {
    rodzaj: 'KRK',
    etykieta: 'Informacja z KRK (niekaralność)',
    wzorce: [/\bKRK\b/, wz('krajow%\\s+rejestr%\\s+karn%'), /niekaralno[śs]ci?/i],
  },
  {
    rodzaj: 'KRS',
    etykieta: 'Odpis z KRS',
    wzorce: [/\bKRS\b/, wz('krajow%\\s+rejestr%\\s+s[ąa]dow%')],
  },
  {
    rodzaj: 'CEIDG',
    etykieta: 'Wydruk z CEIDG',
    wzorce: [/\bCEIDG\b/],
  },
];

// Nazwy miesięcy (dopełniacz — tak zapisuje się daty w pismach: „12 maja 2026 r.").
// Warianty bez polskich znaków też, żeby złapać tekst z OCR bez diakrytyków.
const MIESIACE = {
  stycznia: 1,
  lutego: 2,
  marca: 3,
  kwietnia: 4,
  maja: 5,
  czerwca: 6,
  lipca: 7,
  sierpnia: 8,
  wrzesnia: 9,
  września: 9,
  pazdziernika: 10,
  października: 10,
  listopada: 11,
  grudnia: 12,
};

/**
 * Sprowadza `plik` do `{ tekst, nazwa }`. Akceptuje string (sam tekst) albo obiekt
 * z tekstem pod jednym z kluczy (`tekst`/`text`/`tresc`/`content`) i opcjonalną
 * nazwą (`nazwa`/`name`). Cokolwiek innego → pusty tekst (funkcja nie rzuca).
 */
function normalizujWejscie(plik) {
  if (typeof plik === 'string') return { tekst: plik, nazwa: null };
  if (plik && typeof plik === 'object') {
    const tekst = pierwszyString(plik.tekst, plik.text, plik.tresc, plik.content);
    const nazwa = pierwszyString(plik.nazwa, plik.name);
    return { tekst: tekst ?? '', nazwa: nazwa ?? null };
  }
  return { tekst: '', nazwa: null };
}

/** Pierwszy argument będący niepustym stringiem (po przycięciu), inaczej null. */
function pierwszyString(...wartosci) {
  for (const w of wartosci) {
    if (typeof w === 'string' && w.trim() !== '') return w.trim();
  }
  return null;
}

// Separatory tysięcy w kwotach z PDF/OCR: zwykła spacja, twarda spacja (U+00A0),
// wąska twarda spacja (U+202F) oraz kropka. Jawne escape'y zamiast niewidzialnych
// znaków w źródle — żeby zapis był czytelny i nie rozjechał się w edytorze.
const SEP_TYSIECY = ' \\u00a0\\u202f.';
// Kwota w formacie polskim: część całkowita z opcjonalnymi separatorami tysięcy
// i dwucyfrowa część dziesiętna po przecinku; ALBO prosty zapis z kropką
// dziesiętną (123456.78).
const WZ_KWOTA = new RegExp(
  `\\d{1,3}(?:[${SEP_TYSIECY}]\\d{3})+,\\d{2}|\\d+,\\d{2}|\\d+\\.\\d{2}`,
  'g',
);

/**
 * Zamienia surowy zapis kwoty na liczbę. Ostatni z „,"/„." to separator
 * dziesiętny; wszystko przed nim (spacje, kropki, przecinki) to separatory tysięcy.
 */
function kwotaNaLiczbe(surowa) {
  const s = surowa.replace(/[^\d.,]/g, '');
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (sep === -1) return Number(s);
  const calosc = s.slice(0, sep).replace(/[.,\s]/g, '');
  const ulamek = s.slice(sep + 1).replace(/\D/g, '');
  const liczba = Number(`${calosc || '0'}.${ulamek}`);
  return Number.isFinite(liczba) ? liczba : null;
}

/** Etykieta waluty przy dopasowanej kwocie: zł/złotych/PLN → 'PLN', inaczej null. */
function walutaPrzy(kontekst) {
  return /z[łl]otych|z[łl]|\bPLN\b/i.test(kontekst) ? 'PLN' : null;
}

/**
 * Wyciąga cenę: skanuje wiersze, punktuje dopasowane kwoty wg kontekstu
 * (wzmianka o „cenie" i „brutto" ma pierwszeństwo nad netto / kwotą bez kontekstu)
 * i wybiera najlepszą. Bez żadnej kwoty w kontekście ceny → wszystko null.
 */
function wyodrebnijCene(tekst) {
  const pusta = { kwota: null, waluta: null, surowa: null };
  let najlepsza = null;
  let najlepszyWynik = -1;

  for (const wiersz of tekst.split(/\r?\n/)) {
    const maCene = /cen[aeioęy]|warto[śs][ćc]|kwot|wynagrodzeni/i.test(wiersz);
    const maBrutto = /brutto/i.test(wiersz);
    const maNetto = /netto/i.test(wiersz);

    for (const m of wiersz.matchAll(WZ_KWOTA)) {
      const surowaLiczba = m[0];
      const koniec = m.index + surowaLiczba.length;
      // Kontekst waluty: to, co bezpośrednio za kwotą (np. „ zł", „ PLN").
      const ogon = wiersz.slice(koniec, koniec + 12);
      const waluta = walutaPrzy(ogon);

      // Kwota zupełnie bez kontekstu ceny i bez waluty jest niewiarygodna — pomijamy
      // (np. numer konta, NIP z groszami), żeby nie zgadywać ceny z przypadkowej liczby.
      if (!maCene && !waluta) continue;

      // Punktacja: liczba przy „cenie" jest wiarygodna; brutto > netto; waluta potwierdza.
      let wynik = 0;
      if (maCene) wynik += 5;
      if (maBrutto) wynik += 3;
      else if (maNetto) wynik += 1;
      if (waluta) wynik += 1;

      if (wynik > najlepszyWynik) {
        najlepszyWynik = wynik;
        // `surowa` obejmuje kwotę wraz z walutą, jeśli tuż za nią występuje.
        const dopasowanieWaluty = ogon.match(/^\s*(z[łl]otych|z[łl]|PLN)/i);
        najlepsza = {
          kwota: kwotaNaLiczbe(surowaLiczba),
          waluta,
          surowa: dopasowanieWaluty ? `${surowaLiczba}${dopasowanieWaluty[0]}` : surowaLiczba,
        };
      }
    }
  }

  return najlepsza ?? pusta;
}

/**
 * Rozpoznaje formę podpisu wg NAJWCZEŚNIEJSZEJ wzmianki w tekście (dokument zwykle
 * najpierw deklaruje, czym podpisano ofertę). Rdzenie dobrane tak, by łapać formy
 * odmienione („kwalifikowanym", „osobistym"). Brak wzmianki → PODPIS_NIEOKRESLONY.
 */
function wyodrebnijFormatPodpisu(tekst) {
  const dolny = tekst.toLowerCase();
  const kandydaci = [
    { typ: 'kwalifikowany', idx: dolny.indexOf('kwalifikowan') },
    { typ: 'osobisty', idx: dolny.indexOf('osobist') },
    { typ: 'zaufany', idx: najmniejszyIndeks(dolny, ['zaufan', 'epuap']) },
  ].filter((k) => k.idx >= 0);

  if (kandydaci.length === 0) return PODPIS_NIEOKRESLONY;
  kandydaci.sort((a, b) => a.idx - b.idx);
  return kandydaci[0].typ;
}

/** Najmniejszy nieujemny indeks wystąpienia któregokolwiek z wzorców, inaczej -1. */
function najmniejszyIndeks(tekst, wzorce) {
  let min = -1;
  for (const w of wzorce) {
    const i = tekst.indexOf(w);
    if (i >= 0 && (min === -1 || i < min)) min = i;
  }
  return min;
}

/** Oświadczenia obecne w tekście — w kolejności katalogu (bez duplikatów). */
function wyodrebnijOswiadczenia(tekst) {
  return KATALOG_OSWIADCZEN.filter((o) => o.wzorce.some((w) => w.test(tekst))).map((o) => ({
    rodzaj: o.rodzaj,
    etykieta: o.etykieta,
  }));
}

/**
 * Zaświadczenia obecne w tekście + data każdego. Datę szukamy w OBRĘBIE wiersza,
 * w którym pojawił się wzorzec instytucji — dzięki temu data z linii ZUS nie
 * „przecieka" do KRK. Brak daty w tym wierszu → data null (wciąż zgłaszamy rodzaj).
 */
function wyodrebnijZaswiadczenia(tekst) {
  const wiersze = tekst.split(/\r?\n/);
  const wynik = [];
  for (const z of KATALOG_ZASWIADCZEN) {
    const wiersz = wiersze.find((w) => z.wzorce.some((wzor) => wzor.test(w)));
    if (!wiersz) continue;
    const data = wyodrebnijDate(wiersz);
    wynik.push({ rodzaj: z.rodzaj, etykieta: z.etykieta, data: data.iso, surowaData: data.surowa });
  }
  return wynik;
}

/**
 * Pierwsza data w segmencie tekstu → `{ iso: 'YYYY-MM-DD'|null, surowa }`. Obsługuje
 * ISO (2026-04-20), z kropkami/ukośnikami (05.05.2026, 05/05/2026) i słowny miesiąc
 * w dopełniaczu (12 maja 2026). Zwraca pierwszy WŁAŚCIWY (istniejący) układ.
 */
function wyodrebnijDate(segment) {
  const iso = segment.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const wynik = zbudujDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (wynik) return { iso: wynik, surowa: iso[0] };
  }

  const numeryczna = segment.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (numeryczna) {
    const wynik = zbudujDate(Number(numeryczna[3]), Number(numeryczna[2]), Number(numeryczna[1]));
    if (wynik) return { iso: wynik, surowa: numeryczna[0] };
  }

  const slowna = segment.match(/(\d{1,2})\s+([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż]+)\s+(\d{4})/);
  if (slowna) {
    const miesiac = MIESIACE[slowna[2].toLowerCase()];
    if (miesiac) {
      const wynik = zbudujDate(Number(slowna[3]), miesiac, Number(slowna[1]));
      if (wynik) return { iso: wynik, surowa: slowna[0] };
    }
  }

  return { iso: null, surowa: null };
}

/**
 * Buduje 'YYYY-MM-DD' z części, odrzucając daty nieistniejące (np. 2026-02-30) —
 * sprawdzamy round-tripem przez UTC, żeby nie przepuścić cichej normalizacji.
 */
function zbudujDate(rok, miesiac, dzien) {
  if (!Number.isInteger(rok) || !Number.isInteger(miesiac) || !Number.isInteger(dzien)) return null;
  const d = new Date(Date.UTC(rok, miesiac - 1, dzien));
  if (d.getUTCFullYear() !== rok || d.getUTCMonth() !== miesiac - 1 || d.getUTCDate() !== dzien) {
    return null;
  }
  const mm = String(miesiac).padStart(2, '0');
  const dd = String(dzien).padStart(2, '0');
  return `${rok}-${mm}-${dd}`;
}

/**
 * Wyodrębnia pola z dokumentu oferty (podzadanie 8/13).
 *
 * Nazwa snake_case celowo zgodna ze specyfikacją — to kontrakt wołany przez
 * podzadania analizy przesłanek odrzucenia.
 *
 * @param {string|{tekst?:string,text?:string,tresc?:string,content?:string,nazwa?:string,name?:string}} plik
 *   tekst dokumentu (warstwa tekstowa PDF / wynik OCR) jako string albo obiekt
 *   niosący ten tekst; opcjonalna nazwa pliku przechodzi do wyniku.
 * @returns {{
 *   nazwaPliku: string|null,
 *   cena: { kwota: number|null, waluta: 'PLN'|null, surowa: string|null },
 *   formatPodpisu: 'kwalifikowany'|'zaufany'|'osobisty'|'nieokreslony',
 *   oswiadczenia: Array<{ rodzaj: string, etykieta: string }>,
 *   zaswiadczenia: Array<{ rodzaj: string, etykieta: string, data: string|null, surowaData: string|null }>,
 * }} wyekstrahowane pola — zawsze pełny kształt (puste pola przy braku danych).
 */
export function wyodrebnij_pola_z_oferty(plik) {
  const { tekst, nazwa } = normalizujWejscie(plik);

  return {
    nazwaPliku: nazwa,
    cena: wyodrebnijCene(tekst),
    formatPodpisu: wyodrebnijFormatPodpisu(tekst),
    oswiadczenia: wyodrebnijOswiadczenia(tekst),
    zaswiadczenia: wyodrebnijZaswiadczenia(tekst),
  };
}
