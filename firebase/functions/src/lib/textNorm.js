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
function hitsToken(keywordStem, tokenStems) {
  if (keywordStem.length >= MIN_PREFIX) {
    return tokenStems.some((t) => t.startsWith(keywordStem));
  }
  return tokenStems.includes(keywordStem);
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
    const parts = stemTokens(keyword);
    if (!parts.length) continue;
    if (parts.every((part) => hitsToken(part, tokenStems)) && !hits.includes(keyword)) {
      hits.push(keyword);
    }
  }
  return hits;
}
