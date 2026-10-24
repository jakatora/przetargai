/*
 * Limity kosztowe dopasowań — wspólne dla starego silnika (services/matching.js)
 * i selekcji pod klienta (services/pracownik.js). Uzasadnienia przy definicjach
 * pierwotnych (audyty 2026-07-09/10) zostały w services/matching.js.
 */
export const AI_PREFILTER_MIN = 15;
export const AI_CALLS_PER_DAY = Object.freeze({ free: 10, standard: 120 });
export const CANDIDATE_HEAD = 120;
export const OKNO_KANDYDATOW = 150;
export const MAKS_PRZEJRZANYCH = 600;
