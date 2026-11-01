import { klasaCpv, normWojewodztwo } from './wynikiAgregacja.js';
import { normNip } from './profilKonkurenta.js';

/*
 * KARTA Z WYGRANYCH (2026-11-01). Leniwy start: firma wpisuje sam NIP, a zakres dopasowań bierzemy
 * z przetargów, które REALNIE wygrała (rozstrzygnięcia BZP z roku) — dokładniej niż zgadywanie
 * z nazwy firmy („DACHY KOWALSKI”) i bez klikania po katalogu CPV. Proponujemy, nie nadpisujemy:
 * aplikacja wypełnia tylko puste pola karty.
 *
 * CPV: wszystkie kody wygranych postępowań, ważone liczbą wygranych części; z każdej klasy (4 cyfry)
 * jeden najczęstszy kod — dopasowanie i tak łapie klasę po prefiksie. Regiony: województwa z co
 * najmniej 20% wygranych (zawsze najczęstsze), do 4; rozsiane po kraju (5+ bez przewagi) = bez
 * ograniczenia. Tytuły wygranych idą do podpowiedzi słów kluczowych.
 *
 * CZYSTA funkcja, bez I/O.
 */

export const MAKS_KODOW = 8;
const MAKS_REGIONOW = 4;
const MIN_UDZIAL_REGIONU = 0.2;
const MAKS_TYTULOW = 8;

/**
 * @param {object[]} wyniki rozstrzygnięcia, w których firma wygrała co najmniej jedną część
 * @param {string} nip NIP firmy
 * @returns {{znaleziono: boolean, wygrane: number, cpv_codes: string[], regiony: string[], tytuly: string[], zamawiajacych: number}}
 */
export function kartaZWygranych(wyniki, nip) {
  const moj = normNip(nip);
  const kody = new Map();
  const regiony = new Map();
  const zamawiajacy = new Set();
  const tytuly = [];
  const widziane = new Set();
  let wygrane = 0;
  const posortowane = [...(Array.isArray(wyniki) ? wyniki : [])]
    .sort((a, b) => String(b?.opublikowano ?? '').localeCompare(String(a?.opublikowano ?? '')));
  for (const w of posortowane) {
    const klucz = w?.externalId ?? w?.id;
    if (!w || !moj || (klucz && widziane.has(klucz))) continue;
    if (klucz) widziane.add(klucz);
    const czesci = (w.czesci ?? []).filter((c) => c && !c.uniewaznione && normNip(c.zwyciezca?.nip) === moj).length;
    if (!czesci) continue;
    wygrane += czesci;
    for (const kod of Array.isArray(w.cpv) ? w.cpv : [w.cpv]) {
      const czysty = String(kod ?? '').match(/^\d{8}(?:-\d)?/)?.[0];
      if (czysty) kody.set(czysty, (kody.get(czysty) ?? 0) + czesci);
    }
    const woj = normWojewodztwo(w.wojewodztwo);
    if (woj) regiony.set(woj, (regiony.get(woj) ?? 0) + czesci);
    const zam = normNip(w.zamawiajacyNip ?? w.zamawiajacy_nip) ?? w.zamawiajacy;
    if (zam) zamawiajacy.add(zam);
    if (w.tytul && tytuly.length < MAKS_TYTULOW) tytuly.push(String(w.tytul).replace(/\s+/g, ' ').trim().slice(0, 160));
  }

  // Kod całego działu („45000000” = wszystkie roboty budowlane) przy dokładniejszych z tego działu
  // tylko rozmywa dopasowania — pomijamy go, zostaje, gdy jest jedynym w dziale.
  const dzialowe = (kod) => /^\d{2}0{6}/.test(kod);
  const maDokladniejszy = (kod) => [...kody.keys()].some((k) => !dzialowe(k) && k.slice(0, 2) === kod.slice(0, 2));
  for (const kod of [...kody.keys()]) if (dzialowe(kod) && maDokladniejszy(kod)) kody.delete(kod);

  const najlepszyWKlasie = new Map();
  for (const [kod, n] of kody) {
    const klasa = klasaCpv(kod) ?? kod.slice(0, 4);
    const byl = najlepszyWKlasie.get(klasa);
    const suma = (byl?.suma ?? 0) + n;
    najlepszyWKlasie.set(klasa, !byl || n > byl.n ? { kod, n, suma } : { ...byl, suma });
  }
  const cpvCodes = [...najlepszyWKlasie.values()]
    .sort((a, b) => b.suma - a.suma || a.kod.localeCompare(b.kod))
    .slice(0, MAKS_KODOW)
    .map((x) => x.kod);

  const wgRegionu = [...regiony.entries()].sort((a, b) => b[1] - a[1]);
  const sumaRegionow = wgRegionu.reduce((s, [, n]) => s + n, 0);
  const rozsiane = wgRegionu.length >= 5 && wgRegionu[0][1] / sumaRegionow < MIN_UDZIAL_REGIONU * 2;
  const wybrane = rozsiane ? [] : wgRegionu
    .filter(([, n], i) => i === 0 || n / sumaRegionow >= MIN_UDZIAL_REGIONU)
    .slice(0, MAKS_REGIONOW)
    .map(([kod]) => kod);

  return {
    znaleziono: wygrane > 0,
    wygrane,
    cpv_codes: cpvCodes,
    regiony: wybrane,
    tytuly,
    zamawiajacych: zamawiajacy.size,
  };
}
