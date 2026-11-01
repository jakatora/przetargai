import { rodzajKryterium, MAKS_KRYTERIOW } from './ogloszenieMeta.js';

/*
 * KRYTERIA OCENY Z TED (2026-11-01) — ten sam kształt co `parsujKryteria` dla BZP, żeby karta
 * „Za co są punkty”, znacznik na liście („Tylko cena” / „Cena 60% · Termin 40%”) i `kryterium_oceny`
 * działały też dla ogłoszeń unijnych (343 z 1310 otwartych dopasowań 1.11 było z TED, bez etykiety).
 *
 * eForms (API v3) podaje kryteria SPŁASZCZONE ze wszystkich części: `award-criterion-type-lot`
 * (BT-539: price / quality / cost — jest zawsze), `-name-lot` (BT-734), `-number-lot` (BT-541, waga),
 * `-number-weight-lot` (BT-5421: per-exa = procent, poi-exa = punkty, dec-exa = ułamek,
 * ord-imp = kolejność), `-description-lot` (BT-540). Zmierzone na 500 ogłoszeniach z Polski
 * (20–31.10.2026): typ w 467, opis zgodny co do liczby w 466, waga w 344, nazwa tylko w 222 —
 * i często WYŁĄCZNIE dla kryteriów jakościowych (cena bez nazwy).
 *
 * Granice części: przy wagach procentowych i punktowych każda część sumuje się do 100 (254/254
 * i 84/84 w próbce) — po tym dzielimy. Bez wag — po okresie powtarzania typów. Wagę bez
 * BT-541 bierzemy z opisu („waga 60%”, „max 94 pkt”) tylko wtedy, gdy KAŻDA część znów daje 100.
 *
 * CZYSTA funkcja, bez I/O.
 */

const MAKS_NAZWY = 120;
const NAZWA_RODZAJU = {
  gwarancja: 'Gwarancja', platnosc: 'Termin płatności', umowa: 'Warunki umowy', reakcja: 'Czas reakcji', termin: 'Termin realizacji',
  spoleczne: 'Aspekty społeczne', srodowisko: 'Aspekty środowiskowe', certyfikat: 'Certyfikaty', koncepcja: 'Koncepcja',
  doswiadczenie: 'Doświadczenie', dodatkowe: 'Dodatkowe usługi', dostepnosc: 'Dostępność', jakosc: 'Jakość',
};
const SUMA_CZESCI = { 'per-exa': 100, 'poi-exa': 100, 'dec-exa': 1 };
const SPOSOB = { 'per-exa': 'procentowo', 'poi-exa': 'punktowo', 'dec-exa': 'procentowo', 'ord-imp': 'kolejnosc' };

/** Wielojęzyczne pole TED → lista po polsku (albo w pierwszym dostępnym języku). */
function lista(pole) {
  if (Array.isArray(pole)) return pole;
  if (!pole || typeof pole !== 'object') return [];
  const w = pole.pol ?? Object.values(pole)[0];
  return Array.isArray(w) ? w : w != null ? [w] : [];
}

const liczba = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Waga z opisu: najpierw procent, potem „max N pkt” / „N pkt”. */
function wagaZOpisu(opis) {
  const t = String(opis ?? '');
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*%/) ?? t.match(/max(?:ymalnie|\.)?\s*(\d+(?:[.,]\d+)?)\s*(?:pkt|punkt)/i) ?? t.match(/(\d+(?:[.,]\d+)?)\s*(?:pkt|punkt)/i);
  return m ? liczba(m[1]) : null;
}

/** Podział płaskiej listy na części po sumie wag (każda część = `suma`); null, gdy się nie składa. */
function czesciPoSumie(pozycje, suma) {
  const czesci = [];
  let biezaca = [];
  let s = 0;
  for (const p of pozycje) {
    if (p.waga === null) return null;
    biezaca.push(p);
    s += p.waga;
    if (Math.abs(s - suma) < suma * 1e-4) { czesci.push(biezaca); biezaca = []; s = 0; } else if (s > suma) return null;
  }
  return biezaca.length ? null : czesci;
}

/** Podział po najkrótszym okresie powtarzania typów (bez wag) — inaczej całość jako jedna część. */
function czesciPoOkresie(pozycje) {
  const n = pozycje.length;
  for (let p = 1; p < n; p++) {
    if (n % p) continue;
    if (pozycje.every((x, i) => x.typ === pozycje[i % p].typ)) {
      const czesci = [];
      for (let i = 0; i < n; i += p) czesci.push(pozycje.slice(i, i + p));
      return czesci;
    }
  }
  return [pozycje];
}

/** Krótka nazwa z opisu: „kryterium „Termin dostawy”” → „Termin dostawy”; „Efektywność - uwzględnia…” → „Efektywność”. */
function nazwaZOpisu(opis) {
  const t = String(opis ?? '').replace(/\s+/g, ' ').trim();
  const cytat = t.match(/kryteri\w*\s*[„"]([^”"]{3,80})[”"]/i)?.[1] ?? t.match(/^[„"]([^”"]{3,80})[”"]/)?.[1];
  if (cytat) return cytat.trim();
  const odcinek = t.split(/\s[-–]\s|:|\(|\.\s/)[0]
    .replace(/^\s*(?:\d+(?:\.\d+)*\.?|[a-z]\))\s*/i, '')
    .replace(/^kryterium\s+/i, '')
    .trim();
  return odcinek.length >= 3 && odcinek.length <= 60 ? odcinek : null;
}

/**
 * Rodzaj: cena/koszt wprost z typu; jakościowe po nazwie od zamawiającego, a bez niej po opisie
 * oczyszczonym ze stałych formułek („Szczegółowy opis kryterium w pkt 28 IDW” robiło z każdego
 * kryterium „koncepcję”). Nierozpoznane — „jakość”, bo tak je oznaczył TED.
 */
function rodzajTed(typ, nazwa, opis) {
  if (typ === 'price' || typ === 'cost') return 'cena';
  const tekst = nazwa || String(opis ?? '').slice(0, 300).replace(/(?:szczegółow\w*\s+)?opis\w*\s+kryteri\w*/gi, ' ');
  const r = tekst ? rodzajKryterium(tekst) : 'inne';
  return r === 'cena' || r === 'inne' ? 'jakosc' : r;
}

/**
 * @param {object} notice ogłoszenie z TED API v3 (pola `award-criterion-*-lot`)
 * @returns {{lista: {nazwa: string, waga: number|null, udzial: number|null, rodzaj: string}[], sposob: string|null, rozne_w_czesciach: boolean, pozacenowe: boolean}|null}
 */
export function parsujKryteriaTed(notice) {
  const typy = lista(notice?.['award-criterion-type-lot']).map(String);
  if (!typy.length) return null;
  const n = typy.length;
  const nazwy = lista(notice['award-criterion-name-lot']).map((x) => String(x ?? '').trim());
  const opisy = lista(notice['award-criterion-description-lot']).map((x) => String(x ?? ''));
  const liczby = lista(notice['award-criterion-number-lot']).map(liczba);
  const rodzajWagi = lista(notice['award-criterion-number-weight-lot'])[0] ?? null;

  // Nazwy: komplet albo tylko dla kryteriów jakościowych (cena bywa bez nazwy).
  const jakosciowe = typy.map((t, i) => (t === 'quality' ? i : -1)).filter((i) => i >= 0);
  const nazwaPoz = new Array(n).fill(null);
  if (nazwy.length === n) nazwy.forEach((x, i) => { nazwaPoz[i] = x || null; });
  else if (nazwy.length && nazwy.length === jakosciowe.length) jakosciowe.forEach((idx, j) => { nazwaPoz[idx] = nazwy[j] || null; });
  const opisPoz = opisy.length === n ? opisy : new Array(n).fill(null);

  const pozycje = typy.map((typ, i) => ({ typ, nazwa: nazwaPoz[i], opis: opisPoz[i], waga: liczby.length === n ? liczby[i] : null }));
  const suma = SUMA_CZESCI[rodzajWagi] ?? 100;
  let czesci = liczby.length === n ? czesciPoSumie(pozycje, suma) : null;
  if (!czesci && liczby.length !== n && opisy.length === n) {
    const zOpisu = pozycje.map((p) => ({ ...p, waga: wagaZOpisu(p.opis) }));
    czesci = czesciPoSumie(zOpisu, 100);
  }
  if (!czesci) czesci = czesciPoOkresie(pozycje.map((p) => ({ ...p, waga: liczby.length === n ? p.waga : null })));

  const doListy = (czesc) => {
    const l = czesc.slice(0, MAKS_KRYTERIOW).map((p) => {
      const zOpisu = p.nazwa ? null : nazwaZOpisu(p.opis);
      const rodzaj = rodzajTed(p.typ, p.nazwa ?? zOpisu, p.opis);
      // Bez nazwy w ogłoszeniu i w opisie — nazwa z rodzaju („Termin”), nie ogólne „Jakość” przy terminie dostawy.
      const nazwa = (p.nazwa ?? (p.typ === 'price' ? 'Cena' : p.typ === 'cost' ? 'Koszt' : zOpisu ?? NAZWA_RODZAJU[rodzaj] ?? 'Jakość')).slice(0, MAKS_NAZWY);
      return { nazwa, waga: p.waga, rodzaj };
    });
    const s = l.reduce((a, k) => a + (k.waga ?? 0), 0);
    const pelne = l.every((k) => k.waga !== null) && s > 0;
    return l.map((k) => ({ ...k, udzial: l.length === 1 ? 100 : pelne ? Math.round((k.waga / s) * 1000) / 10 : null }));
  };
  const listy = czesci.map(doListy);
  const podpis = (l) => l.map((k) => `${k.rodzaj}|${k.nazwa.toLowerCase()}|${k.waga}`).join(';');
  return {
    lista: listy[0],
    sposob: SPOSOB[rodzajWagi] ?? null,
    rozne_w_czesciach: listy.some((l) => podpis(l) !== podpis(listy[0])),
    pozacenowe: typy.some((t) => t === 'quality'),
  };
}
