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

const ROZSTRZYGNIETE = new Set(['wygrana', 'przegrana']);

function grupa(wpis, terazMs) {
  const status = wpis?.status ?? 'rozwazam';
  if (ROZSTRZYGNIETE.has(status)) return 3;
  const termin = Date.parse(wpis?.tender?.deadline ?? '');
  if (Number.isFinite(termin) && termin <= terazMs) return 3;
  if (status === 'zlozona') return 1;
  if (!Number.isFinite(termin)) return 2;
  return 0;
}

export function kolejnoscZapisanych(wpisy, teraz = new Date().toISOString()) {
  if (!Array.isArray(wpisy)) return [];
  const terazMs = Date.parse(teraz);
  return wpisy
    .map((wpis, i) => ({ wpis, i, g: grupa(wpis, terazMs), t: Date.parse(wpis?.tender?.deadline ?? '') }))
    .sort((a, b) => {
      if (a.g !== b.g) return a.g - b.g;
      if (a.g === 3 || a.g === 2) return a.i - b.i; // serwer: od najnowszego zapisu
      return (a.t - b.t) || (a.i - b.i);
    })
    .map((x) => x.wpis);
}
