import { dzialCpv } from './wynikiAgregacja.js';

/*
 * DZIAŁ CPV Z TYTUŁU (2026-11-01). platformazakupowa.pl i e-ProPublico nie podają kodów CPV — karta „Czy warto
 * startować?” nie miała dla nich kubełków (konkurencja, ceny, „ile dać”). BZP ma tytuł + CPV w każdym ogłoszeniu
 * i wyniku, więc uczymy się z niego: naiwny Bayes na rdzeniach słów tytułu (pierwsze 6 liter po normalizacji),
 * wynik tylko gdy model jest pewny (`MIN_PEWNOSC`). Dział (2 cyfry), nie kod — ekran nie pokazuje zmyślonego CPV,
 * a pole `cpv_dzial_z_tytulu` czytają wyłącznie klucze kubełków. CZYSTA logika.
 */
// Zmierzone 1.11 na 16,8 tys. odłożonych tytułów BZP: próg 0,99 = trafność 89,6% przy pokryciu 32%
// (0,8 dawało 77,6% — za mało, żeby podsuwać ceny „tej branży”).
export const MIN_PEWNOSC = 0.99;
const DLUGOSC_RDZENIA = 6;
const POMIJANE = new Set(['dostaw', 'usluga', 'uslugi', 'wykona', 'realiz', 'zamowi', 'zadani', 'przetar', 'postep', 'ramach',
  'potrze', 'zakres', 'zwiazk', 'okresi', 'roku', 'latach', 'czesci', 'czesc', 'pakiet', 'swiadc', 'zakup', 'sukces']);

const bezOgonkow = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

export function rdzenieTytulu(tytul) {
  const slowa = bezOgonkow(String(tytul ?? '').toLowerCase()).split(/[^a-z]+/).filter((s) => s.length >= 4);
  return [...new Set(slowa.map((s) => s.slice(0, DLUGOSC_RDZENIA)).filter((r) => !POMIJANE.has(r)))];
}

/**
 * @param {{tytul?: string, cpv?: string}[]} przyklady tytuł + kod CPV (BZP: ogłoszenia, rozstrzygnięcia)
 * @returns {{dzialy: Record<string, number>, slowa: Record<string, Record<string, number>>, n: number}}
 */
export function nauczModel(przyklady, { minWystapien = 5 } = {}) {
  const dzialy = {};
  const slowa = {};
  let n = 0;
  for (const p of przyklady ?? []) {
    const d = dzialCpv(p?.cpv);
    const r = rdzenieTytulu(p?.tytul);
    if (!d || !r.length) continue;
    n += 1;
    dzialy[d] = (dzialy[d] ?? 0) + 1;
    for (const s of r) {
      slowa[s] ??= {};
      slowa[s][d] = (slowa[s][d] ?? 0) + 1;
    }
  }
  // Rzadkie słowa to szum (nazwy własne, literówki) i ciężar dokumentu w bazie.
  for (const [s, poDz] of Object.entries(slowa)) if (Object.values(poDz).reduce((a, b) => a + b, 0) < minWystapien) delete slowa[s];
  return { dzialy, slowa, n };
}

/** @returns {{dzial: string, pewnosc: number}|null} */
export function przewidzDzial(tytul, model) {
  if (!model?.n) return null;
  const rdzenie = rdzenieTytulu(tytul).filter((r) => model.slowa[r]);
  if (!rdzenie.length) return null;
  const k = Object.keys(model.dzialy).length;
  const wyniki = [];
  for (const [d, nd] of Object.entries(model.dzialy)) {
    let log = Math.log(nd / model.n);
    for (const r of rdzenie) log += Math.log(((model.slowa[r][d] ?? 0) + 0.5) / (nd + 0.5 * k));
    wyniki.push([d, log]);
  }
  wyniki.sort((a, b) => b[1] - a[1]);
  const max = wyniki[0][1];
  const suma = wyniki.reduce((s, [, l]) => s + Math.exp(l - max), 0);
  const pewnosc = 1 / suma;
  return pewnosc >= MIN_PEWNOSC ? { dzial: wyniki[0][0], pewnosc: Math.round(pewnosc * 1000) / 1000 } : null;
}

/** Zwarty zapis do jednego dokumentu `meta` (~0,3–0,5 MB): „rdzen:45=12,71=3;…”. */
export function modelDoTekstu(model) {
  return Object.entries(model.slowa).map(([s, d]) => `${s}:${Object.entries(d).map(([k, v]) => `${k}=${v}`).join(',')}`).join(';');
}

export function modelZTekstu(tekst, dzialy, n) {
  const slowa = {};
  for (const wpis of String(tekst ?? '').split(';')) {
    const i = wpis.indexOf(':');
    if (i < 1) continue;
    slowa[wpis.slice(0, i)] = Object.fromEntries(wpis.slice(i + 1).split(',').map((x) => x.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k, Number(v)]));
  }
  return { dzialy: dzialy ?? {}, slowa, n: Number(n) || 0 };
}
