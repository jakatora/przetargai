/**
 * Walidacja polskiego numeru NIP (10 cyfr + cyfra kontrolna).
 * Czysta funkcja — bez zależności, testowalna w izolacji.
 */

const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

/** Usuwa spacje, myślniki i prefiks „PL". */
export function normalizeNip(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/^PL/, '')
    .replace(/[\s-]/g, '');
}

/** Czy NIP jest poprawny (format + suma kontrolna). */
export function isValidNip(raw) {
  const nip = normalizeNip(raw);
  if (!/^\d{10}$/.test(nip)) return false;

  const digits = nip.split('').map(Number);
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  const checksum = sum % 11;

  // Reszta 10 oznacza NIP niemożliwy do utworzenia — zawsze niepoprawny.
  if (checksum === 10) return false;
  return checksum === digits[9];
}
