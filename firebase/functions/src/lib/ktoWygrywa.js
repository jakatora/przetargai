/*
 * „KTO TU WYGRYWA” (2026-10-31, z analizy konkurencji: Pressinfo „Analizator”, eGospodarka „Kto wygrał”).
 * Benchmark zamawiającego (lib/benchmark.js) mówi, ILE firm startuje i JAKA cena wygrywa — ale nie KTO.
 * Wykonawca przed tygodniem pracy nad ofertą chce wiedzieć, z kim przegrywa: czy ten zamawiający
 * od lat bierze tę samą firmę, czy wygrywają małe firmy, jakie były ostatnie rozstrzygnięcia.
 * Czysta funkcja nad kolekcją `rozstrzygniecia` (BZP + TED). Zasady jak w benchmarku:
 *  • zwycięzców grupujemy po NIP-ie (nazwa bywa pisana różnie), bez NIP-u po znormalizowanej nazwie;
 *  • kwoty tylko z części `spojne` (BZP ma kwoty arytmetycznie niemożliwe);
 *  • listy zwycięzców nie pokazujemy z próbki mniejszej niż MIN_CZESCI_Z_UMOWA.
 */
export const MIN_CZESCI_Z_UMOWA = 3;
export const TOP_ZWYCIEZCOW = 5;
export const OSTATNICH = 5;

const normNazwa = (s) => String(s ?? '').toLowerCase().replace(/["„”'’]/g, '').replace(/\b(sp\.?\s*z\s*o\.?\s*o\.?|spółka z ograniczoną odpowiedzialnością|s\.?a\.?|sp\.?\s*k\.?|sp\.?\s*j\.?)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * @param {object[]} wyniki rozstrzygnięcia jednego zamawiającego (dowolna kolejność)
 * @returns {{wystarczajaca: boolean, probka: {ogloszenia: number, czesci_z_umowa: number, uniewaznione: number, od: string|null, do: string|null},
 *   zwyciezcy: {nazwa: string, nip: string|null, wygrane: number, wartosc: number|null, maly: boolean|null, ostatnio: string|null}[],
 *   ostatnie: {tytul: string|null, opublikowano: string|null, zwyciezca: string|null, cena: number|null, liczba_ofert: number|null, uniewaznione: boolean}[],
 *   zrodla: string[]}}
 */
export function ktoWygrywa(wyniki) {
  const lista = (Array.isArray(wyniki) ? wyniki : []).filter(Boolean);
  const grupy = new Map();
  const zrodla = new Set();
  let czesciZUmowa = 0;
  let uniewaznione = 0;
  let od = null;
  let doDaty = null;
  const ostatnie = [];

  for (const w of lista) {
    if (w.zrodlo) zrodla.add(w.zrodlo);
    const dzien = w.opublikowano ?? null;
    if (dzien) {
      if (!od || dzien < od) od = dzien;
      if (!doDaty || dzien > doDaty) doDaty = dzien;
    }
    for (const c of w.czesci ?? []) {
      if (c?.uniewaznione) { uniewaznione++; continue; }
      const z = c?.zwyciezca;
      if (!z?.nazwa) continue;
      czesciZUmowa++;
      const klucz = z.nip ? `nip:${String(z.nip).replace(/\D/g, '') || z.nip}` : `nazwa:${normNazwa(z.nazwa)}`;
      if (!grupy.has(klucz)) grupy.set(klucz, { nazwa: z.nazwa, nip: z.nip ?? null, wygrane: 0, wartosc: 0, maKwote: false, maly: null, ostatnio: null });
      const g = grupy.get(klucz);
      g.wygrane++;
      if (c.spojne && Number.isFinite(c.cenaWybrana)) { g.wartosc += c.cenaWybrana; g.maKwote = true; }
      if (c.wygralMaly === true || c.wygralMaly === false) g.maly = c.wygralMaly;
      if (dzien && (!g.ostatnio || dzien > g.ostatnio)) { g.ostatnio = dzien; g.nazwa = z.nazwa; }
    }
  }

  const posortowane = [...lista].sort((a, b) => String(b.opublikowano ?? '').localeCompare(String(a.opublikowano ?? '')));
  for (const w of posortowane) {
    if (ostatnie.length >= OSTATNICH) break;
    const czesci = w.czesci ?? [];
    const zUmowa = czesci.find((c) => !c?.uniewaznione && c?.zwyciezca?.nazwa);
    ostatnie.push({
      tytul: w.tytul ?? null,
      opublikowano: w.opublikowano ?? null,
      zwyciezca: zUmowa?.zwyciezca?.nazwa ?? null,
      cena: zUmowa?.spojne && Number.isFinite(zUmowa.cenaWybrana) ? zUmowa.cenaWybrana : null,
      liczba_ofert: Number.isFinite(zUmowa?.liczbaOfert) ? zUmowa.liczbaOfert : null,
      uniewaznione: czesci.length > 0 && czesci.every((c) => c?.uniewaznione),
    });
  }

  const wystarczajaca = czesciZUmowa >= MIN_CZESCI_Z_UMOWA;
  const zwyciezcy = wystarczajaca
    ? [...grupy.values()]
      .sort((a, b) => b.wygrane - a.wygrane || (b.wartosc - a.wartosc) || String(b.ostatnio).localeCompare(String(a.ostatnio)))
      .slice(0, TOP_ZWYCIEZCOW)
      .map(({ maKwote, wartosc, ...g }) => ({ ...g, wartosc: maKwote ? Math.round(wartosc) : null }))
    : [];

  return {
    wystarczajaca,
    probka: { ogloszenia: lista.length, czesci_z_umowa: czesciZUmowa, uniewaznione, od, do: doDaty },
    zwyciezcy,
    ostatnie,
    zrodla: [...zrodla].sort(),
  };
}
