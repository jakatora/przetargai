/**
 * Kolejność „Zapisanych” (audyt ścieżki 2026-11-10): co pilne — na górze.
 *
 * Serwer zwraca wpisy od najnowszego zapisu, a wykonawca z kilkoma przetargami pyta
 * „co mam najbliżej”. Grupy (w tej kolejności):
 *   0 — w grze (rozważam / przygotowuję) z terminem w przyszłości: od najbliższego terminu,
 *   1 — oferta złożona, czeka na wynik: od najbliższego terminu,
 *   2 — w grze, ale bez terminu w ogłoszeniu,
 *   3 — historia: termin minął albo rozstrzygnięty (wygrana/przegrana): od najnowszego zapisu.
 * Czysta funkcja, nie zmienia wejścia.
 */

import { chwilaUplywuTerminu } from './dataUtc.js';

const ROZSTRZYGNIETE = new Set(['wygrana', 'przegrana']);
// Sama data = koniec tego dnia w Polsce, zapis nie-ISO nie jest zgadywany (QA 2026-11-13).
const chwila = (deadline) => chwilaUplywuTerminu(deadline)?.ms ?? NaN;

function grupa(wpis, terazMs) {
  const status = wpis?.status ?? 'rozwazam';
  if (ROZSTRZYGNIETE.has(status)) return 3;
  const termin = chwila(wpis?.tender?.deadline);
  if (Number.isFinite(termin) && termin <= terazMs) return 3;
  if (status === 'zlozona') return 1;
  if (!Number.isFinite(termin)) return 2;
  return 0;
}

export function kolejnoscZapisanych(wpisy, teraz = new Date().toISOString()) {
  if (!Array.isArray(wpisy)) return [];
  const terazMs = Date.parse(teraz);
  return wpisy
    .map((wpis, i) => ({ wpis, i, g: grupa(wpis, terazMs), t: chwila(wpis?.tender?.deadline) }))
    .sort((a, b) => {
      if (a.g !== b.g) return a.g - b.g;
      if (a.g === 3 || a.g === 2) return a.i - b.i; // serwer: od najnowszego zapisu
      return (a.t - b.t) || (a.i - b.i);
    })
    .map((x) => x.wpis);
}

/**
 * Jedno zdanie nad listą Zapisanych (2026-11-12, runda 4): ile przetargów jest w grze i ile dni do
 * najbliższego terminu — bez czytania wszystkich kart. `null`, gdy nic nie jest w grze.
 * @returns {{pl: string, en: string, pilne: boolean}|null}
 */
export function podsumowanieZapisanych(wpisy, teraz = new Date().toISOString()) {
  const terazMs = Date.parse(teraz);
  const wGrze = (Array.isArray(wpisy) ? wpisy : []).filter((w) => grupa(w, terazMs) === 0);
  if (!wGrze.length) return null;
  const najblizszy = Math.min(...wGrze.map((w) => chwila(w.tender.deadline)));
  const dni = Math.max(0, Math.floor((najblizszy - terazMs) / 86_400_000));
  const n = wGrze.length;
  const ile = n === 1 ? '1 przetarg w grze' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? `${n} przetargi w grze` : `${n} przetargów w grze`;
  const kiedy = dni === 0 ? 'najbliższy termin dziś' : dni === 1 ? 'najbliższy termin jutro' : `najbliższy termin za ${dni} dni`;
  const whenEn = dni === 0 ? 'nearest deadline today' : dni === 1 ? 'nearest deadline tomorrow' : `nearest deadline in ${dni} days`;
  // `termin` — sama druga połowa zdania, dla „Moich ofert” (seria 2 runda 7).
  return { pl: `${ile} · ${kiedy}`, en: `${n} in play · ${whenEn}`, pilne: dni <= 3, termin: { pl: kiedy, en: whenEn } };
}
