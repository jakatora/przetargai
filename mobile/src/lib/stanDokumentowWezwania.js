import { opisStatusu } from './sejf.js';

/*
 * Odpowiedź na wezwanie: przy każdym zaznaczonym załączniku pokazujemy od razu, czy taki
 * dokument jest w Sejfie i czy jest ważny — zamiast odsyłać użytkownika do Sejfu, żeby
 * sam sprawdził. Dopasowanie po słowach kluczowych nazwy (ten sam zbiór co podpowiedzi
 * strażnika), bo lista z wezwania to wolny tekst. CZYSTA logika, nigdy nie rzuca.
 */

const WZORCE = [
  { klucz: /\bzus\b|składk/i, kategoria: 'zus' },
  { klucz: /\bus\b|urząd skarbow|urzędu skarbow|podatk/i, kategoria: 'us' },
  { klucz: /krk|karn|niekaraln/i, kategoria: 'krk' },
  { klucz: /krs|ceidg|rejestr/i, kategoria: 'rejestr' },
  { klucz: /polis|ubezpiecz|\boc\b/i, kategoria: 'polisa' },
  { klucz: /wykaz (robót|usług|dostaw)|referenc/i, kategoria: 'wykaz' },
  { klucz: /wykaz osób|uprawnie/i, kategoria: 'osoby' },
];

function kategoria(tekst) {
  const t = String(tekst ?? '');
  return WZORCE.find((w) => w.klucz.test(t))?.kategoria ?? null;
}

/**
 * @param {Array<{nazwa?: string, status?: string|null, data_wystawienia?: string|null}>} dokumentySejfu
 * @param {string[]} zalaczniki nazwy zaznaczone w odpowiedzi na wezwanie
 * @returns {Object<string, {wSejfie: boolean, status: string|null, etykieta: string, ton: string}>}
 *   klucz = nazwa załącznika; brak klucza = nie umiemy dopasować (np. „inny dokument").
 */
export function stanZalacznikowZSejfu(dokumentySejfu, zalaczniki) {
  const sejf = (Array.isArray(dokumentySejfu) ? dokumentySejfu : []).filter((d) => d && typeof d === 'object');
  const wynik = {};
  for (const nazwa of Array.isArray(zalaczniki) ? zalaczniki : []) {
    const kat = kategoria(nazwa);
    if (!kat) continue;
    const pasujace = sejf.filter((d) => kategoria(d.nazwa) === kat);
    if (!pasujace.length) {
      wynik[nazwa] = { wSejfie: false, status: null, etykieta: 'Brak w Sejfie', ton: 'ostrzezenie' };
      continue;
    }
    // Najlepszy egzemplarz: gotowy > zamów nowy > nieznany > przeterminowany.
    const ranga = { gotowy: 0, zamow_nowy: 1, nieznany: 2, przeterminowany: 3 };
    const najlepszy = pasujace
      .map((d) => d.status ?? 'nieznany')
      .sort((a, b) => (ranga[a] ?? 9) - (ranga[b] ?? 9))[0];
    const opis = opisStatusu(najlepszy === 'nieznany' ? null : najlepszy);
    wynik[nazwa] = { wSejfie: true, status: najlepszy, etykieta: `W Sejfie: ${opis.etykieta}`, ton: opis.ton };
  }
  return wynik;
}
