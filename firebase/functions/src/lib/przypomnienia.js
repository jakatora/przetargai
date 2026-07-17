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

/**
 * Etapy przypomnień o terminie (runda 11): 7, 3 i 1 dzień przed składaniem ofert.
 * Więcej sygnałów niż jedno „48 h" — parity z konkurencją, lepsze utrzymanie.
 */
export const ETAPY_DNI = [7, 3, 1];
const DZIEN_MS = 24 * 60 * 60 * 1000;

/**
 * Następne przypomnienie do wysłania.
 *
 * Zwraca najbliższy PRZYSZŁY etap, który jeszcze nie został wysłany. Etapy minione
 * w chwili włączenia są POMIJANE (nie odpalamy „za 7 dni", gdy zostały 3). Gdy
 * wszystkie etapy minęły przy włączeniu (termin bardzo blisko), dajemy jedno
 * natychmiastowe „ostatnie wezwanie" (etap 0) — ale tylko raz i tylko gdy nic
 * jeszcze nie wysłano (normalna ścieżka 7→3→1 nie dokłada etapu 0).
 *
 * @param {string|null} deadlineIso
 * @param {string} nowIso
 * @param {number[]} wyslane etapy już wysłane (np. [7, 3])
 * @returns {{at: string, etap: number}|null}
 */
export function nastepneRemind(deadlineIso, nowIso, wyslane = []) {
  if (!deadlineIso) return null;
  const deadline = new Date(deadlineIso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(deadline) || !Number.isFinite(now) || deadline <= now) return null;

  const przyszle = ETAPY_DNI
    .filter((d) => !wyslane.includes(d))
    .map((d) => ({ etap: d, at: deadline - d * DZIEN_MS }))
    .filter((x) => x.at > now)
    .sort((a, b) => a.at - b.at);

  if (przyszle.length) {
    const n = przyszle[0];
    return { at: new Date(n.at).toISOString(), etap: n.etap };
  }
  // Wszystkie etapy minęły — jedno natychmiastowe wezwanie, tylko przy włączeniu.
  if (wyslane.length === 0) return { at: new Date(now).toISOString(), etap: 0 };
  return null;
}
