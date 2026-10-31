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

/*
 * Nazwa wykonawcy do wyświetlenia (produkcja 31.10): BZP bywa, że wpisuje adres w pole nazwy —
 * „MICRONE Sp. z o.o. pl. Strzelecki 20 50-224 Wrocław”. Ucinamy od ulicy/placu/alei albo kodu pocztowego.
 */
export function czystaNazwaWykonawcy(nazwa) {
  const s = String(nazwa ?? '').replace(/\s+/g, ' ').trim();
  const ciecie = s.search(/,?\s+(ul\.|ulica|pl\.|plac|al\.|aleja|os\.|osiedle)\s|,?\s+\d{2}-\d{3}\b/i);
  const wynik = (ciecie > 3 ? s.slice(0, ciecie) : s).replace(/[,;\s]+$/, '');
  return wynik || s;
}

/*
 * Formy prawne tylko jako osobne słowa (granice liter Unicode): bez nich „Masa” traciło „sa”,
 * a „spółka z o.o.” małymi literami zostawało w kluczu (31.10, test profilu konkurenta).
 */
const FORMY_PRAWNE = /(?<![\p{L}\p{N}])(spółka z ograniczoną odpowiedzialnością|spółka komandytowo-akcyjna|spółka komandytowa|spółka jawna|spółka cywilna|spółka akcyjna|spółka z o\.?\s*o\.?|sp\.?\s*z\s*o\.?\s*o\.?|sp\.?\s*k\.?|sp\.?\s*j\.?|s\.?\s*c\.?|s\.?\s*a\.?)(?![\p{L}\p{N}])/gu;

/** Klucz porównania nazw: bez formy prawnej, cudzysłowów i interpunkcji (ta sama firma raz z NIP-em, raz bez). */
export function normNazwa(s) {
  return czystaNazwaWykonawcy(s).toLowerCase().replace(/["„”'’]/g, '')
    .replace(FORMY_PRAWNE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

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
  // Jedna grupa na firmę: po NIP-ie ALBO po znormalizowanej nazwie (ta sama firma bywa raz z NIP-em, raz bez).
  const poNip = new Map();
  const poNazwie = new Map();
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
      const nip = z.nip ? String(z.nip).replace(/\D/g, '') || String(z.nip) : null;
      const nazwaKlucz = normNazwa(z.nazwa);
      let g = (nip && poNip.get(nip)) || poNazwie.get(nazwaKlucz) || null;
      if (!g) {
        g = { nazwa: czystaNazwaWykonawcy(z.nazwa), nip: z.nip ?? null, wygrane: 0, wartosc: 0, maKwote: false, maly: null, ostatnio: null };
        grupy.set(grupy.size, g);
      }
      if (nip && !poNip.has(nip)) poNip.set(nip, g);
      if (nazwaKlucz && !poNazwie.has(nazwaKlucz)) poNazwie.set(nazwaKlucz, g);
      if (!g.nip && z.nip) g.nip = z.nip;
      g.wygrane++;
      if (c.spojne && Number.isFinite(c.cenaWybrana)) { g.wartosc += c.cenaWybrana; g.maKwote = true; }
      if (c.wygralMaly === true || c.wygralMaly === false) g.maly = c.wygralMaly;
      if (dzien && (!g.ostatnio || dzien > g.ostatnio)) { g.ostatnio = dzien; g.nazwa = czystaNazwaWykonawcy(z.nazwa); }
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
      zwyciezca: zUmowa?.zwyciezca?.nazwa ? czystaNazwaWykonawcy(zUmowa.zwyciezca.nazwa) : null,
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
