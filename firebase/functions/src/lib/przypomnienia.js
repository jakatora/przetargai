/**
 * Kiedy wysłać przypomnienie o zbliżającym się terminie składania ofert.
 *
 * Domyślnie 48 h przed terminem — dość, by przygotować ofertę, ale nie za
 * wcześnie, żeby przypomnienie było na czasie. Gdy do terminu jest mniej niż
 * 48 h, przypominamy jak najszybciej (remind_at = teraz), ale NIGDY po terminie
 * ani dla przetargu bez terminu.
 *
 * Czysta funkcja — testowana bez emulatora.
 */

export const LEAD_MS = 48 * 60 * 60 * 1000;

/**
 * @param {string|null|undefined} deadlineIso termin składania (kanoniczne ISO UTC)
 * @param {string} nowIso „teraz" jako ISO — wstrzykiwane, żeby test był deterministyczny
 * @returns {string|null} moment wysłania przypomnienia (ISO) albo null
 */
export function obliczRemindAt(deadlineIso, nowIso) {
  if (!deadlineIso) return null;
  const deadline = new Date(deadlineIso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return null;

  // Termin minął (albo jest dokładnie teraz) — nie ma o czym przypominać.
  if (deadline <= now) return null;

  const target = deadline - LEAD_MS;
  // Nie planujemy przypomnienia w przeszłości: gdy termin bliżej niż 48 h,
  // przypominamy przy najbliższym przebiegu.
  return new Date(Math.max(target, now)).toISOString();
}
