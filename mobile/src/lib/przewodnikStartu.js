/**
 * „Przewodnik startu: czy jesteś gotowy?" — checklista WEJŚCIA dla firmy, która dopiero
 * zaczyna z przetargami. Zbiera absolutne minimum, bez którego nie da się złożyć oferty
 * (firma, brak wykluczenia, podpis elektroniczny, konto na platformie) + rzeczy, które
 * warto mieć gotowe (dokumenty, profil w apce). Stan firmowy — jeden zapis, nie per przetarg.
 */

export const KROKI_STARTU = [
  { klucz: 'firma', tytul: 'Zarejestrowana firma i numery',
    opis: 'Działalność w CEIDG lub KRS, NIP i REGON. To Twoja tożsamość w każdym postępowaniu.' },
  { klucz: 'wykluczenie', tytul: 'Czysta karta (brak podstaw wykluczenia)',
    opis: 'Brak zaległości w US i ZUS, niekaralność osób z zarządu, brak upadłości/likwidacji (art. 108–109 Pzp).' },
  { klucz: 'podpis', tytul: 'Podpis elektroniczny',
    opis: 'Powyżej progów UE — kwalifikowany. Poniżej — wystarczy DARMOWY podpis zaufany (profil zaufany) albo osobisty (e-dowód). Bez podpisu nie złożysz oferty.' },
  { klucz: 'platforma', tytul: 'Konto na platformie zakupowej',
    opis: 'e-Zamówienia (BZP) oraz platforma zamawiającego (Marketplanet, Logintrade, eB2B, SmartPZP). Załóż je ZANIM zacznie tykać zegar terminu.' },
  { klucz: 'doreczenia', tytul: 'Adres do e-Doręczeń / ePUAP',
    opis: 'Kanał korespondencji z zamawiającym — coraz częściej wymagany do doręczeń.' },
  { klucz: 'dokumenty', tytul: 'Świeże dokumenty pod ręką', ekran: 'Sejf',
    opis: 'Zaświadczenia US/ZUS/KRK, odpis KRS/CEIDG, referencje. Trzymaj je w Sejfie z licznikiem ważności — urząd nie wyda ich w 5 dni.' },
  { klucz: 'profil', tytul: 'Ustawiony profil firmy w aplikacji', ekran: 'Account',
    opis: 'Słowa kluczowe i kody CPV — dzięki nim AI dopasowuje trafne przetargi do Twojej firmy.' },
];

/**
 * @param {Set<string>|string[]} wykonane
 * @returns {{pozycje: object[], zrobione: number, wszystkich: number, procent: number, gotowe: boolean}}
 */
export function podsumujStart(wykonane) {
  const zbior = wykonane instanceof Set ? wykonane : new Set(Array.isArray(wykonane) ? wykonane : []);
  const pozycje = KROKI_STARTU.map((k) => ({ ...k, wykonany: zbior.has(k.klucz) }));
  const zrobione = pozycje.filter((p) => p.wykonany).length;
  return {
    pozycje,
    zrobione,
    wszystkich: KROKI_STARTU.length,
    procent: KROKI_STARTU.length ? Math.round((100 * zrobione) / KROKI_STARTU.length) : 0,
    gotowe: zrobione === KROKI_STARTU.length,
  };
}

const KLUCZ = 'przetargai.przewodnik-startu';

export async function wczytajStart(storage) {
  try {
    const raw = await storage.getItem(KLUCZ);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export async function zapiszStart(storage, wykonane) {
  const arr = [...(wykonane instanceof Set ? wykonane : new Set(Array.isArray(wykonane) ? wykonane : []))];
  await storage.setItem(KLUCZ, JSON.stringify(arr));
}
