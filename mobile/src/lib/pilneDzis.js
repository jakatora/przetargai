/**
 * „Pilne dziś” (2026-11-12, runda 10): to, co pali się dziś, nad wyborem dnia — żeby nie trzeba było
 * zaglądać osobno do Zapisanych i do alertów. Czysta logika; komponent `PilneDzis` tylko rysuje.
 *
 * Pilne =
 *  • zapisany przetarg W GRZE (rozważam / przygotowuję) z terminem ofert w ciągu `DNI_PILNE` dni,
 *  • nieprzeczytane alerty (zmiana SWZ, nowy termin, wynik, decyzja szefa).
 * Złożone i rozstrzygnięte oferty nie są pilne — tam już nic się nie składa.
 */
import { chwilaUplywuTerminu } from './dataUtc.js';
import { dniDoTerminu } from './kolejnoscZapisanych.js';

export const DNI_PILNE = 3;
// Termin podany samą datą upływa z końcem tego dnia w Polsce — ta sama reguła co w reszcie apki (QA 2026-11-13).
const chwila = (deadline) => chwilaUplywuTerminu(deadline)?.ms ?? NaN;
const W_GRZE = new Set(['rozwazam', 'przygotowuje']);

// Dni kalendarzowe jak na kartach; godziny tylko, gdy termin jest dziś (QA 2026-11-13).
const kiedy = (deadline, ms, terazMs) => {
  const dni = dniDoTerminu(deadline, terazMs)?.dni ?? 0;
  if (dni <= 0) {
    const godz = (ms - terazMs) / 3_600_000;
    return { pl: godz < 1 ? 'termin za mniej niż godzinę' : `termin dziś, za ${Math.floor(godz)} godz.`, en: godz < 1 ? 'due in under an hour' : `due today, in ${Math.floor(godz)} h` };
  }
  return { pl: dni === 1 ? 'termin jutro' : `termin za ${dni} dni`, en: dni === 1 ? 'due tomorrow' : `due in ${dni} days` };
};

/**
 * @param {{zapisane?: object[], nieprzeczytane?: number, teraz?: string}} wejscie
 * @returns {Array<{klucz: string, rodzaj: 'termin'|'alerty', tytul: string|{pl: string, en: string},
 *   opis: {pl: string, en: string}, wpis?: object}>} najwyżej 3 terminy (najbliższy pierwszy) + alerty
 */
export function pilneDzis({ zapisane = [], nieprzeczytane = 0, teraz = new Date().toISOString() } = {}) {
  const terazMs = Date.parse(teraz);
  const granica = terazMs + DNI_PILNE * 86_400_000;
  const terminy = (Array.isArray(zapisane) ? zapisane : [])
    .map((w) => ({ w, ms: chwila(w?.tender?.deadline) }))
    .filter(({ w, ms }) => W_GRZE.has(w?.status ?? 'rozwazam') && Number.isFinite(ms) && ms > terazMs && ms <= granica)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 3)
    .map(({ w, ms }) => ({ klucz: `termin-${w.tender.id ?? w.id}`, rodzaj: 'termin', tytul: w.tender.title ?? '—', opis: kiedy(w.tender.deadline, ms, terazMs), wpis: w }));
  const n = Number(nieprzeczytane) || 0;
  const alerty = n > 0 ? [{
    klucz: 'alerty', rodzaj: 'alerty',
    tytul: { pl: n === 1 ? '1 nowy alert' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? `${n} nowe alerty` : `${n} nowych alertów`, en: n === 1 ? '1 new alert' : `${n} new alerts` },
    opis: { pl: 'zmiany w zapisanych przetargach', en: 'changes in saved tenders' },
  }] : [];
  return [...terminy, ...alerty];
}
