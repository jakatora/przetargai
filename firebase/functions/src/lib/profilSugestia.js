import { NAZWY_CPV } from './cpvNazwy.js';

/**
 * Onboarding AI (rundy 9-10) — czysta logika: prompt + sanityzacja odpowiedzi.
 *
 * Właściciel JDG nie zna kodów CPV — to największy wyciek aktywacji. Daje opis
 * firmy prostym językiem, model proponuje słowa kluczowe i kody CPV, user tylko
 * akceptuje. Odpowiedzi modelu NIE ufamy — twardo sanityzujemy.
 *
 * KATALOG I KRÓTKIE SŁOWA (2026-11-02). Sprawdzone na prawdziwym wywołaniu: dla „Remont posadzka żywica” model dał
 * kody 45262000, 45261000 (dachy), 45230000 (rurociągi, drogi) — żadnego kodu podłóg (4543…) — i frazy w rodzaju
 * „układanie posadzki żywicznej”, które w silniku wymagają WSZYSTKICH słów naraz (konto z takim hasłem: 0 dopasowań
 * przez tydzień). Teraz model wybiera kody wyłącznie z katalogu pickera aplikacji (ten sam, z którego user wybiera
 * ręcznie; kod spoza katalogu odrzucamy), a słowa mają 1–2 wyrazy w postaci z tytułów ogłoszeń.
 */

const MAKS_OPIS = 600;
const MAKS_KEYWORDS = 8;
const MAKS_CPV = 6;
const MAKS_SLOW_W_FRAZIE = 3;

function tekst(v, maks) {
  return String(v ?? '').trim().slice(0, maks);
}

/** Redukuje CPV do 8 cyfr (bez sufiksu kontrolnego „-7”). null gdy niepoprawny albo spoza katalogu. */
function normalizujCpv(surowy) {
  const cyfry = String(surowy ?? '').replace(/\D/g, '');
  return cyfry.length >= 8 && NAZWY_CPV[cyfry.slice(0, 8)] ? cyfry.slice(0, 8) : null;
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
    ? unikalne(obj.keywords.map((k) => tekst(k, 40)).filter((k) => k && k.split(/\s+/).length <= MAKS_SLOW_W_FRAZIE)).slice(0, MAKS_KEYWORDS)
    : [];

  const cpv = Array.isArray(obj.cpv)
    ? unikalne(obj.cpv.map(normalizujCpv).filter(Boolean)).slice(0, MAKS_CPV)
    : [];

  return { keywords, cpv };
}

const KATALOG = Object.entries(NAZWY_CPV).map(([kod, nazwa]) => `${kod} ${nazwa}`).join('\n');

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
    '  "keywords": ["<4-6 słów kluczowych po 1-2 wyrazy>"],',
    '  "cpv": ["<1-3 kody z KATALOGU niżej>"]',
    '}',
    'Słowa kluczowe: rzeczowniki tak, jak stoją w tytułach ogłoszeń (np. „kostka brukowa”, „posadzka żywiczna”, „chodnik”),',
    'najwyżej 2 wyrazy; bez ogólników („usługi”, „remont”, „dostawa”, „roboty”) — silnik wymaga w tytule KAŻDEGO wyrazu frazy.',
    'Kody CPV wybierz WYŁĄCZNIE z katalogu (kod jak w katalogu): 1-3 NAJWĘŻSZE pasujące. Kodów „— wszystkie” i „Pozostałe …”',
    'używaj tylko, gdy nic węższego nie pasuje; gdy żaden kod nie pasuje, zwróć pustą listę.',
    '<katalog>',
    KATALOG,
    '</katalog>',
  ].join('\n');
}
