import { czySwz } from './eZamowieniaDokumenty.js';
import { liniePdf } from './tekstPdf.js';
import { parsujKryteriaSwz } from '../lib/kryteriaSwz.js';
import { parsujWadiumSwz } from '../lib/wadium.js';
import { pobierzPdfBase64 } from '../jobs/autoAnalizaSwz.js';

/*
 * Kryteria z SWZ dla ogłoszeń platformazakupowa.pl bez kryteriów w tabeli i bez bliźniaka w BZP/TED
 * (2026-11-01). Na 37 takich otwartych dopasowaniach 22 miały SWZ w PDF, z tego 13 dało się odczytać
 * (reszta to skany bez tekstu). Bez AI: `lib/kryteriaSwz.js` czyta rozdział o kryteriach.
 */

/** Plik SWZ z załączników szczegółu: „SWZ.pdf”, a nie „Załącznik nr 3 do SWZ”. */
export function plikSwzPz(szczegol) {
  const zal = Array.isArray(szczegol?.zalaczniki) ? szczegol.zalaczniki.filter((z) => z?.url) : [];
  const jakoDok = (z) => ({ nazwa: z.nazwa, plik: z.nazwa, rozszerzenie: z.rozszerzenie });
  return zal.find((z) => czySwz(jakoDok(z)) && !/za[lł][aą]cznik/i.test(z.nazwa ?? ''))
    ?? zal.find((z) => czySwz(jakoDok(z))) ?? null;
}

/**
 * @returns {Promise<object|null>} wynik `parsujKryteriaSwz` albo null (brak SWZ, skan, brak sumy 100).
 */
export async function kryteriaZSwzPz(szczegol, { pobierz = pobierzPdfBase64, czytaj = liniePdf } = {}) {
  const plik = plikSwzPz(szczegol);
  if (!plik) return null;
  const linie = await czytaj(Buffer.from(await pobierz(plik.url), 'base64'));
  return parsujKryteriaSwz((Array.isArray(linie) ? linie : []).map((l) => (typeof l === 'string' ? l : l?.tekst ?? '')));
}

/**
 * Jedno pobranie SWZ, dwa odczyty (2026-11-01): kryteria oceny i wadium (`lib/wadium.js` → `parsujWadiumSwz`) —
 * platforma nie podaje żadnego z nich. Brak SWZ w PDF → null.
 * @returns {Promise<{kryteria: object|null, wadium: {wymagane: boolean|null, kwota: number|null, wieleCzesci?: boolean}}|null>}
 */
export async function daneZSwzPz(szczegol, { pobierz = pobierzPdfBase64, czytaj = liniePdf } = {}) {
  const plik = plikSwzPz(szczegol);
  if (!plik) return null;
  const linie = (await czytaj(Buffer.from(await pobierz(plik.url), 'base64')) ?? []).map((l) => (typeof l === 'string' ? l : l?.tekst ?? ''));
  return { kryteria: parsujKryteriaSwz(linie), wadium: parsujWadiumSwz(linie) };
}
