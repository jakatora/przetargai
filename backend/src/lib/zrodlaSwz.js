import { createHash } from 'node:crypto';

export function mapaStron(wartosc, tresc) {
  let p = wartosc;
  try { if (typeof p === 'string') p = JSON.parse(p); } catch { return null; }
  return Array.isArray(p) && p.length > 0 && p[0] === 0
    && p.every((x, i) => Number.isInteger(x) && x >= 0 && x <= String(tresc ?? '').length && (i === 0 || x >= p[i - 1])) ? p : null;
}

export function bezpiecznyUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

export function opisZrodla(rekord = {}) {
  return {
    rodzaj: rekord.rodzaj ?? 'wersja', id: rekord.id ?? null, numer: rekord.numer ?? null,
    hash: typeof rekord.tresc === 'string' ? createHash('sha256').update(rekord.tresc).digest('hex') : null,
    data: rekord.data_publikacji ?? rekord.created_at ?? null,
    url: bezpiecznyUrl(rekord.sciezka),
  };
}

/** Dowód z faktycznego przedziału w treści, bez numerów stron wymyślonych przez model. */
export function cytatZPozycji(rekord, start, koniec) {
  const tresc = String(rekord?.tresc ?? '');
  if (!Number.isInteger(start) || !Number.isInteger(koniec) || start < 0 || koniec <= start || koniec > tresc.length) return null;
  const strony = mapaStron(rekord.strony, tresc);
  let strona = null;
  if (strony) {
    strona = 1;
    for (let i = 1; i < strony.length && strony[i] <= start; i++) strona = i + 1;
  }
  return {
    tekst: tresc.slice(start, Math.min(koniec, start + 1200)), potwierdzony: true,
    strona, linia: strony ? null : tresc.slice(0, start).split('\n').length,
    skrocony: koniec - start > 1200, zrodlo: opisZrodla(rekord),
  };
}

/** Weryfikacja fragmentu modelu; toleruje wielkość liter i białe znaki, nic nie dopowiada. */
export function znajdzCytat(fragment, rekord) {
  const szukany = String(fragment ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (szukany.length < 8) return null;
  const tresc = String(rekord?.tresc ?? '');
  let norm = '';
  const indeksy = [];
  for (let i = 0; i < tresc.length; i++) {
    const znak = /\s/.test(tresc[i]) ? ' ' : tresc[i].toLowerCase();
    if (znak === ' ' && norm.endsWith(' ')) continue;
    norm += znak;
    for (let j = 0; j < znak.length; j++) indeksy.push(i);
  }
  const at = norm.indexOf(szukany);
  if (at < 0) return { tekst: String(fragment).slice(0, 1200), potwierdzony: false, strona: null, linia: null, zrodlo: opisZrodla(rekord) };
  return cytatZPozycji(rekord, indeksy[at], indeksy[at + szukany.length - 1] + 1);
}

export function poczatkiLinii(tresc) {
  const wynik = [0];
  for (let i = 0; i < tresc.length; i++) if (tresc[i] === '\n') wynik.push(i + 1);
  return wynik;
}

/** PDF ma spłaszczone białe znaki; granice stron również wyznaczają fragmenty diffu. */
export function linieZrodla(rekord) {
  const tresc = String(rekord?.tresc ?? '');
  const poczatki = [...new Set([...poczatkiLinii(tresc), ...(mapaStron(rekord?.strony, tresc) ?? [])])].sort((a, b) => a - b);
  return poczatki.map((start, i) => ({ start, tekst: tresc.slice(start, poczatki[i + 1] ?? tresc.length).replace(/\r?\n$/, '') }));
}
