import { podobienstwoTytulow } from './poprzedniaEdycja.js';
import { polaKryteriow } from './ogloszenieMeta.js';

/*
 * BLIŹNIAK Z KRYTERIAMI (2026-11-01). Postępowanie z ustawy prowadzone na platformazakupowa.pl ma
 * w tabeli platformy tylko „Dokumenty jawne” — kryteria są w SWZ. To samo postępowanie z mocy prawa
 * wisi jednak w BZP (tryb podstawowy) albo TED (nieograniczony) i tam kryteria już mamy. Deduplikacja
 * go nie łączy, bo platforma nie podaje NIP-u, więc szukamy bliźniaka po tym, co się zgadza co do
 * sekundy: termin składania ofert, i po tytule bez znaku sprawy („DZZ.261.31.26 …”).
 *
 * Próbka 1.11.2026 (82 kopie z PZ bez kryteriów): 38 par z podobieństwem 0,82–1,00, reszta ≤ 0,26
 * (inne postępowania z tym samym terminem) — próg 0,6 ma zapas z obu stron.
 *
 * CZYSTA logika: kandydaci (ogłoszenia z tym samym terminem) parametrem.
 */

export const PROG_BLIZNIAKA = 0.6;

/** Tytuł bez znaku sprawy na początku: „2026/BZP 00494036/01 Wykonywanie…”, „ZP-2380/61/26/JW Wykonanie…”. */
export function tytulBezZnaku(tytul) {
  return String(tytul ?? '').replace(/^(?:\s*(?:\S*\d\S*|BZP)\s+)+/i, '').trim();
}

/**
 * @param {{title: string}} tender kopia z platformy (bez kryteriów)
 * @param {object[]} kandydaci ogłoszenia z tym samym terminem (id, title, source, kryteria…)
 * @returns {object} pola kryteriów bliźniaka + `kryteria_z` (jego id) albo {} bez pewnego bliźniaka
 */
export function kryteriaBlizniaka(tender, kandydaci) {
  const tytul = tytulBezZnaku(tender?.title);
  if (!tytul) return {};
  let najlepszy = null;
  for (const k of Array.isArray(kandydaci) ? kandydaci : []) {
    if (!k || (k.source !== 'bzp' && k.source !== 'ted') || !Array.isArray(k.kryteria) || !k.kryteria.length) continue;
    const p = podobienstwoTytulow(tytul, tytulBezZnaku(k.title));
    if (p >= PROG_BLIZNIAKA && (!najlepszy || p > najlepszy.p)) najlepszy = { p, k };
  }
  if (!najlepszy) return {};
  const { k } = najlepszy;
  const pola = polaKryteriow({
    lista: k.kryteria,
    sposob: k.kryteria_sposob ?? null,
    rozne_w_czesciach: k.kryteria_rozne_czesci === true,
    pozacenowe: k.kryteria.some((x) => x?.rodzaj !== 'cena'),
  });
  return { ...pola, kryteria_z: k.id ?? null };
}
