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

/**
 * NIP z wolnego tekstu (TED `buyer-identifier`: „NIP: …, REGON: …", grupy z
 * myślnikami). Bierze pierwszy ciąg
 * 10 cyfr (z dozwolonymi myślnikami/spacjami między grupami) o POPRAWNEJ sumie
 * kontrolnej. Sam REGON (9 cyfr) i śmieci dają null — NIP służy do złączenia planu
 * z późniejszym ogłoszeniem tego samego zamawiającego, więc zgadywanie jest gorsze
 * niż brak.
 * @param {string|string[]|null|undefined} identyfikatory
 * @returns {string|null}
 */
export function wyciagnijNip(identyfikatory) {
  const teksty = (Array.isArray(identyfikatory) ? identyfikatory : [identyfikatory])
    .filter((t) => t != null)
    .map(String);
  for (const tekst of teksty) {
    // Ciągi cyfr z pojedynczymi separatorami: „842-00-06-338", „821 000 65 10".
    for (const ciag of tekst.match(/\d(?:[\s-]?\d)*/g) ?? []) {
      const kandydaci = [ciag, ...ciag.split(/\s+/)];
      for (const k of kandydaci) {
        const cyfry = k.replace(/\D/g, '');
        if (cyfry.length === 10 && isValidNip(cyfry)) return cyfry;
      }
    }
  }
  return null;
}
