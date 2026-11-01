import { dzialCpv, mediana, normWojewodztwo } from './wynikiAgregacja.js';

/*
 * „ILE DAĆ” Z INFORMACJI Z OTWARCIA OFERT (2026-11-01) — czysta logika, zero I/O.
 *
 * Informacja z otwarcia ofert podaje kwotę, którą zamawiający przeznaczył, i ceny złożonych ofert — OBIE
 * brutto. Ich iloraz to jedyna uczciwa miara tego, jak nisko schodzą oferty względem budżetu: z ogłoszeń
 * o wyniku jej nie policzymy (wartość szacunkowa jest netto — `lib/benchmark.js`, zasada 2). Dane zbiera
 * `jobs/otwarcieRynku.js` dla całego rynku BZP/TED na e-Zamówieniach.
 *
 * Zasady: bez zamówień w częściach (kwota i ceny nie z tej samej części), iloraz spoza 0,2–2 to błąd odczytu,
 * a kubełek mówi cokolwiek dopiero od `MIN_PROBKA_OTWARCIA` przetargów.
 */
export const MIN_PROBKA_OTWARCIA = 8;
const PRZEDROSTEK = 'otw:';

/** Obserwacja z jednego przetargu albo null (części, brak liczb, iloraz niewiarygodny). */
export function obserwacjaOtwarcia(t) {
  const o = t?.otwarcie_ofert;
  if (!o || o.czesci || !(o.kwota >= 1000) || !(o.cena_min > 0) || !(o.oferty >= 1)) return null;
  const stosunek = o.cena_min / o.kwota;
  if (!(stosunek >= 0.2 && stosunek <= 2)) return null;
  return { dzial: dzialCpv(t.cpv_main ?? t.cpv), woj: normWojewodztwo(t.wojewodztwo), stosunek, oferty: o.oferty };
}

/** Klucze kubełków przetargu: dział CPV w województwie, potem w kraju. */
export function kluczeOtwarcia(tender) {
  const dzial = dzialCpv(tender?.cpv_main ?? tender?.cpv) ?? (/^\d{2}$/.test(String(tender?.cpv_dzial_z_tytulu ?? '')) ? tender.cpv_dzial_z_tytulu : null);
  const woj = normWojewodztwo(tender?.wojewodztwo);
  return { region: dzial && woj ? `${PRZEDROSTEK}${dzial}|${woj}` : null, kraj: dzial ? `${PRZEDROSTEK}${dzial}` : null };
}

function kwantyl(posortowane, q) {
  if (!posortowane.length) return null;
  const i = (posortowane.length - 1) * q;
  const d = Math.floor(i);
  return posortowane[d] + (posortowane[Math.min(d + 1, posortowane.length - 1)] - posortowane[d]) * (i - d);
}

/**
 * @param {object[]} przetargi z `otwarcie_ofert`, `cpv_main`, `wojewodztwo`
 * @returns {Record<string, {dzial: string, woj: string|null, n: number, stosunek: {mediana: number, q1: number, q3: number}, oferty_mediana: number}>}
 */
export function zbudujBenchmarkOtwarcia(przetargi) {
  const grupy = new Map();
  for (const t of przetargi ?? []) {
    const ob = obserwacjaOtwarcia(t);
    if (!ob?.dzial) continue;
    for (const [klucz, woj] of [[`${PRZEDROSTEK}${ob.dzial}`, null], ...(ob.woj ? [[`${PRZEDROSTEK}${ob.dzial}|${ob.woj}`, ob.woj]] : [])]) {
      if (!grupy.has(klucz)) grupy.set(klucz, { dzial: ob.dzial, woj, stosunki: [], oferty: [] });
      grupy.get(klucz).stosunki.push(ob.stosunek);
      grupy.get(klucz).oferty.push(ob.oferty);
    }
  }
  const wynik = {};
  for (const [klucz, g] of grupy) {
    if (g.stosunki.length < MIN_PROBKA_OTWARCIA) continue;
    const s = [...g.stosunki].sort((a, b) => a - b);
    const zaokr = (x) => Math.round(x * 1000) / 1000;
    wynik[klucz] = {
      dzial: g.dzial, woj: g.woj, n: s.length,
      stosunek: { mediana: zaokr(mediana(s)), q1: zaokr(kwantyl(s, 0.25)), q3: zaokr(kwantyl(s, 0.75)) },
      oferty_mediana: mediana(g.oferty),
    };
  }
  return wynik;
}

const zl = (n) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} zł`;
const proc = (x) => `${Math.round(x * 100)}%`;

/**
 * Czynnik karty startu: jak nisko schodzą najniższe oferty względem budżetu w tej branży (i regionie).
 * Żółty = informacja, nie liczy się do werdyktu. Gdy znamy budżet TEGO przetargu (kwota z pisma przed
 * otwarciem) — przeliczamy na złotówki. Bez kubełka — null (nie pokazujemy „nie wiemy”).
 */
export function czynnikIleDac(kubelek, tender) {
  if (!kubelek?.stosunek?.mediana || !(kubelek.n >= MIN_PROBKA_OTWARCIA)) return null;
  const { mediana: m, q1, q3 } = kubelek.stosunek;
  const roznica = Math.round((1 - m) * 100);
  const naglowek = roznica > 0
    ? `Najniższe oferty schodzą zwykle ok. ${roznica}% poniżej budżetu zamawiającego`
    : roznica < 0
      ? `Najniższe oferty bywają zwykle ok. ${-roznica}% powyżej budżetu zamawiającego`
      : 'Najniższe oferty trafiają zwykle w budżet zamawiającego';
  const kwota = tender?.otwarcie_ofert?.kwota;
  const tu = Number.isFinite(kwota) && kwota >= 1000
    ? ` Tu zamawiający przeznaczył ${zl(kwota)} — najniższa oferta wyszłaby zwykle ok. ${zl(kwota * m)}.`
    : '';
  const gdzie = kubelek.woj ? 'w tej branży w Twoim województwie' : 'w tej branży w kraju';
  return {
    kod: 'ile_dac', ton: 'zolty',
    naglowek,
    szczegol: `W połowie przetargów ${gdzie} najniższa oferta to ${proc(q1)}–${proc(q3)} budżetu; ofert zwykle ${kubelek.oferty_mediana}.${tu}`,
    wartosc: m,
    probka: kubelek.n,
  };
}
