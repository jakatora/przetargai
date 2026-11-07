/**
 * Normalizacja tekstu i lekkie sprowadzanie polskich słów do rdzenia.
 *
 * Zwykły `includes()` na tytule ogłoszenia jest podwójnie zły:
 *   • gubi odmiany — "droga" nie jest podciągiem "drogi" (91% przetargów drogowych),
 *   • wpuszcza fałszywki — "budowa" JEST podciągiem "Przebudowa".
 *
 * Rozwiązanie: porównujemy RDZENIE SŁÓW, nie podciągi zdania.
 * To nie jest pełny stemmer (jak Morfologik) — celowo. Obcinamy wyłącznie
 * końcówki fleksyjne, nie derywacyjne, dzięki czemu "budowa" i "przebudowa"
 * pozostają różnymi słowami.
 *
 * ZNANE OGRANICZENIE: nie obsługujemy oboczności spółgłoskowych (droga → drodze,
 * góra → górze). Zmierzone na 500 prawdziwych ogłoszeniach BZP: "drodze" pojawia
 * się w 1 tytule, podczas gdy formy obsługiwane (drogi, dróg, drogowej) w 78.
 * Reguły alternacji dodałyby ryzyko kolizji rdzeni przy pomijalnym zysku.
 * Gdyby kiedyś było to potrzebne — właściwym krokiem są embeddingi (P2), nie
 * kolejne reguły ręczne.
 */

const DIACRITICS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/**
 * Minimalna długość rdzenia — poniżej niej nie obcinamy końcówki.
 * Trzy, nie cztery: przy czterech "gazu" nigdy nie sprowadziłoby się do "gaz".
 */
const MIN_STEM = 3;

/** Minimalna długość rdzenia słowa kluczowego, by dopuścić dopasowanie prefiksowe. */
const MIN_PREFIX = 4;

/** Końcówki fleksyjne, od najdłuższej. Kolejność ma znaczenie. */
const ENDINGS = [
  'iami', 'ymi', 'ich', 'ych', 'ego', 'emu', 'ach', 'ami',
  'ow', 'om', 'em', 'ie', 'ia', 'ej', 'ym',
  'y', 'i', 'a', 'e', 'u', 'o',
];

/** Małe litery, bez diakrytyków, bez nadmiarowych białych znaków. */
export function normalize(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => DIACRITICS[ch])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Obcina końcówkę fleksyjną. Zakłada tekst już znormalizowany.
 * Nigdy nie skraca rdzenia poniżej MIN_STEM znaków.
 */
export function stem(word) {
  if (!word || word.length <= MIN_STEM) return word ?? '';
  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= MIN_STEM) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

/** Rdzenie wszystkich słów tekstu. */
function stemTokens(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

/**
 * Czy rdzeń słowa kluczowego pasuje do któregoś rdzenia z tekstu?
 * Dłuższe rdzenie dopuszczają dopasowanie prefiksowe ("drog" ⊂ "drogow"),
 * krótkie wymagają równości ("gaz" nie może trafiać w "gazet").
 */
/*
 * Znane FAŁSZYWE przedłużenia rdzeni (2026-11-02, pomiar na 17 455 otwartych tytułach × rdzenie 4–5 liter z profili):
 * „prace” → „pracownik/pracowni” (356 trafień), „ziemne” → „ziemniaki” (24), „czas” → „cząstkowy/czasopismo”,
 * „biegi” → „biegły (rewident)”, „roboty” → „robotnicza (odzież)/robotyczny”, „zawody” → „zawodzie”. To inne słowa,
 * nie odmiana — reguła fonetyczna ich nie odróżnia (odcięłaby też „wynajem → wynajmu”, „budowa → budowlany”).
 */
const FALSZYWE_PRZEDLUZENIA = {
  prac: ['pracown', 'pracodaw'],
  ziemn: ['ziemniak', 'ziemniacz'],
  czas: ['czastk', 'czastek', 'czasopism'],
  bieg: ['biegl'],
  robot: ['robotnicz', 'robotyczn', 'robotyk', 'robotyzac'],
  zawod: ['zawodz'],
};

function hitsToken(keywordStem, tokenStems) {
  if (keywordStem.length >= MIN_PREFIX) {
    const falszywe = FALSZYWE_PRZEDLUZENIA[keywordStem] ?? [];
    return tokenStems.some((t) => t.startsWith(keywordStem) && !falszywe.some((f) => t.startsWith(f)));
  }
  return tokenStems.includes(keywordStem);
}

/*
 * Skróty i nazwy branż (2026-11-07). Klient wpisuje „P-poż”, „PV”, „wod-kan”, „elektryka”, a tytuły mówią
 * „przeciwpożarowej”, „fotowoltaicznej”, „wodno-kanalizacyjnej”, „instalacji elektrycznej” — rdzenie się nie spotkają
 * („fotowoltaik” ≠ „fotowoltaiczn”, „kanalizacj” ≠ „kanalizacyjn”). Pomiar na 13 723 otwartych tytułach: P-poż 9 → 55,
 * PV 5 → 62, fotowoltaika 0 → 58, wod-kan 5 → 24, elektryka 0 → 47, kanalizacja 110 → 137, wentylacja 17 → 38.
 * GRUPY są równoważne (każdy człon rozwija się w pozostałe). JEDNOKIERUNKOWE: nazwa branży → frazy pracy, bo sam
 * przymiotnik łapie co innego („elektrycznej” to w 9 na 10 tytułów dostawa prądu, „hydraulicznej” — prasy i oleje).
 * Rozwinięcie tylko zwiększa liczbę kandydatów; o wyborze dalej decyduje ocena AI.
 */
const GRUPY_SKROTOW = [
  ['p.poż', 'ppoż', 'przeciwpożarowy'],
  ['c.o.', 'centralne ogrzewanie'],
  ['wod-kan', 'wodno-kanalizacyjny', 'wodociągowo-kanalizacyjny'],
  ['PV', 'fotowoltaika', 'fotowoltaiczny'],
  ['OZE', 'odnawialne źródła energii', 'odnawialnych źródeł energii'],
  ['kanalizacja', 'kanalizacyjny'],
  ['wentylacja', 'wentylacyjny'],
  ['klimatyzacja', 'klimatyzacyjny'],
  ['termomodernizacja', 'termomodernizacyjny'],
  ['melioracja', 'melioracyjny'],
];
const JEDNOKIERUNKOWE = {
  elektryka: ['instalacja elektryczna', 'roboty elektryczne', 'prace elektryczne'],
  hydraulika: ['instalacja sanitarna', 'instalacja wodno-kanalizacyjna', 'instalacja wodociągowa', 'centralne ogrzewanie'],
};

/** Klucz słownika: rdzenie słowa złączone spacją („P-poż” i „p.poż.” → „p poz”). */
const kluczSlowa = (slowo) => stemTokens(slowo).join(' ');

const ROZWINIECIA = (() => {
  const mapa = new Map();
  const dodaj = (klucz, formy) => mapa.set(klucz, [...new Set([...(mapa.get(klucz) ?? []), ...formy])]);
  for (const grupa of GRUPY_SKROTOW) {
    for (const forma of grupa) dodaj(kluczSlowa(forma), grupa.filter((f) => kluczSlowa(f) !== kluczSlowa(forma)));
  }
  for (const [slowo, formy] of Object.entries(JEDNOKIERUNKOWE)) dodaj(kluczSlowa(slowo), formy);
  return mapa;
})();

/** Formy, w które rozwija się słowo kluczowe klienta (puste = brak w słowniku). */
export function rozwinieciaSlowa(slowo) {
  return ROZWINIECIA.get(kluczSlowa(slowo)) ?? [];
}

/**
 * Zwraca te słowa kluczowe profilu, które trafiają w tekst.
 * Fraza wielowyrazowa ("kostka brukowa") wymaga trafienia KAŻDEGO ze swoich rdzeni.
 * @param {string[]} keywords słowa kluczowe firmy (surowe, mogą mieć diakrytyki)
 * @param {string} text tytuł ogłoszenia (+ ewentualnie zamawiający)
 * @returns {string[]} trafione słowa kluczowe, bez duplikatów, w kolejności profilu
 */
export function matchKeywords(keywords, text) {
  if (!keywords?.length || !text) return [];
  const tokenStems = stemTokens(text);
  if (!tokenStems.length) return [];

  const hits = [];
  for (const keyword of keywords) {
    if (hits.includes(keyword)) continue;
    // Słowo klienta albo któraś z jego form ze słownika skrótów — trafienie zapisujemy jako słowo klienta.
    const trafia = [keyword, ...rozwinieciaSlowa(keyword)].some((forma) => {
      const parts = stemTokens(forma);
      return parts.length > 0 && parts.every((part) => hitsToken(part, tokenStems));
    });
    if (trafia) hits.push(keyword);
  }
  return hits;
}
