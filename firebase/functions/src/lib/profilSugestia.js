/**
 * Onboarding AI (rundy 9-10) — czysta logika: prompt + sanityzacja odpowiedzi.
 *
 * Właściciel JDG nie zna kodów CPV — to największy wyciek aktywacji. Daje opis
 * firmy prostym językiem, model proponuje słowa kluczowe i kody CPV, user tylko
 * akceptuje. Odpowiedzi modelu NIE ufamy — twardo sanityzujemy.
 */

const MAKS_OPIS = 600;
const MAKS_KEYWORDS = 8;
const MAKS_CPV = 6;

function tekst(v, maks) {
  return String(v ?? '').trim().slice(0, maks);
}

/** Redukuje CPV do 8 cyfr (bez sufiksu kontrolnego „-7”). null gdy niepoprawny. */
function normalizujCpv(surowy) {
  const cyfry = String(surowy ?? '').replace(/\D/g, '');
  return cyfry.length >= 8 ? cyfry.slice(0, 8) : null;
}

function unikalne(lista) {
  return [...new Set(lista)];
}

/**
 * @param {string} text odpowiedź modelu (JSON, może być otoczony prozą)
 * @returns {{keywords: string[], cpv: string[]}}
 */
export function parsujSugestie(text) {
  const dopasowanie = String(text).match(/\{[\s\S]*\}/);
  if (!dopasowanie) return { keywords: [], cpv: [] };
  let obj;
  try {
    obj = JSON.parse(dopasowanie[0]);
  } catch {
    return { keywords: [], cpv: [] };
  }

  const keywords = Array.isArray(obj.keywords)
    ? unikalne(obj.keywords.map((k) => tekst(k, 40)).filter(Boolean)).slice(0, MAKS_KEYWORDS)
    : [];

  const cpv = Array.isArray(obj.cpv)
    ? unikalne(obj.cpv.map(normalizujCpv).filter(Boolean)).slice(0, MAKS_CPV)
    : [];

  return { keywords, cpv };
}

/** Prompt użytkownika. Opis przycięty — obrona przed nadużyciem (denial-of-wallet). */
export function buildProfilPrompt(opis) {
  return [
    'Właściciel małej firmy / jednoosobowej działalności opisał, czym się zajmuje:',
    '<opis>',
    tekst(opis, MAKS_OPIS),
    '</opis>',
    '',
    'Zaproponuj profil do wyszukiwania przetargów. Zwróć WYŁĄCZNIE obiekt JSON:',
    '{',
    '  "keywords": ["<3-6 fraz po polsku, którymi opisuje się takie zamówienia>"],',
    '  "cpv": ["<2-5 kodów CPV (8 cyfr) najlepiej pasujących do tej branży>"]',
    '}',
    'Słowa kluczowe konkretne (np. „układanie kostki brukowej", nie „usługi").',
    'Kody CPV realne, 8-cyfrowe. Nie zmyślaj kodów, których nie znasz.',
  ].join('\n');
}
