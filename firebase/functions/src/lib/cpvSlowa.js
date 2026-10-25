import { NAZWY_CPV } from './cpvNazwy.js';
import { parseCpvCodes } from './cpv.js';
import { matchKeywords } from './textNorm.js';

/*
 * Słowa z NAZW kodów CPV firmy (2026-10-25). Ogłoszenia z platformazakupowa.pl i e-ProPublico nie
 * mają kodów CPV, więc profil oparty tylko na kodach (częsty: P-6 w scoring.js) nigdy ich nie
 * widział. Nazwy bierzemy z katalogu pickera w aplikacji (ten sam, z którego user wybiera kody),
 * a słowa ogólne („dostawa", „usługi", „wszystkie") odsiewamy — same niosą zero informacji.
 */
const OGOLNE = new Set([
  'wszystkie', 'inne', 'pozostale', 'oraz', 'dla', 'lub', 'itp', 'typu',
  'dostawa', 'dostawy', 'uslugi', 'usluga', 'roboty', 'prace', 'sprzet', 'urzadzenia', 'produkty', 'artykuly',
  'wyroby', 'materialy', 'systemy', 'system', 'budowa', 'wykonanie', 'obsluga', 'zakup',
]);

const bezOgonkow = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');

/** Nazwa najbliższego znanego kodu: dokładny, potem coraz szersze prefiksy (zera końcowe). */
export function nazwaKodu(kod) {
  const k = String(kod ?? '').replace(/\D/g, '').slice(0, 8);
  if (k.length < 2) return null;
  let rdzen = k.padEnd(8, '0');
  while (rdzen.replace(/0+$/, '').length >= 2) {
    if (NAZWY_CPV[rdzen]) return NAZWY_CPV[rdzen];
    const znaczacy = rdzen.replace(/0+$/, '');
    rdzen = znaczacy.slice(0, -1).padEnd(8, '0');
  }
  return null;
}

/** Słowa kluczowe wyprowadzone z nazw kodów CPV firmy (bez ogólników i słów < 4 znaków), unikalne. */
export function slowaZNazwCpv(kody) {
  const slowa = [];
  for (const kod of parseCpvCodes(kody)) {
    const nazwa = nazwaKodu(kod);
    if (!nazwa) continue;
    for (const s of nazwa.split(/[^\p{L}]+/u)) {
      const czyste = bezOgonkow(s).toLowerCase();
      if (czyste.length < 4 || OGOLNE.has(czyste)) continue;
      if (!slowa.includes(s.toLowerCase())) slowa.push(s.toLowerCase());
    }
  }
  return slowa;
}

/**
 * Słowa z nazw kodów trafione w tytule — w OBIE strony: „drogowe" (nazwa) ↔ „drogi" (tytuł) mają
 * rdzenie „drogow" i „drog"; `matchKeywords` dopuszcza tylko prefiks słowa kluczowego w tekście,
 * więc sprawdzamy też tytuł jako słowa kluczowe względem nazwy.
 * @returns {string[]} słowa z nazw (do wyjaśnienia dla usera), unikalne
 */
export function trafioneSlowaNazw(slowa, tytul) {
  const t = String(tytul ?? '');
  if (!slowa?.length || !t) return [];
  const tokenyTytulu = t.split(/[^\p{L}0-9]+/u).filter((x) => x.length >= 4);
  return slowa.filter((w) => matchKeywords([w], t).length > 0 || matchKeywords(tokenyTytulu, w).length > 0);
}
