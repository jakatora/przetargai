import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import { ekstrahuj_i_normalizuj } from '../lib/umowaEkstrakcja.js';

/*
 * Analiza projektu UMOWY przed podpisem (ulepszenie „pilnowanie waloryzacji
 * i pułapek w umowie"). Klient wysyła treść umowy jako surowy `tekst` ALBO
 * `pdf_base64` (plik PDF zakodowany w base64) — i dostaje listę flag: klauzula
 * waloryzacyjna, kary umowne i ich limit, zapisy o odbiorach i podwykonawcach.
 *
 * STAN: routing + walidacja wejścia (2/12) oraz ekstrakcja i normalizacja
 * tekstu z PDF-a / pola `tekst` (podzadanie 2/12, util `ekstrahuj_i_normalizuj`).
 * Silnik reguł (wykrywanie flag) dochodzi w kolejnych krokach, dlatego `flagi`
 * to na razie pusta lista.
 */

const router = Router();

// Oba pola opcjonalne w schemacie — regułę „co najmniej jedno niesie treść"
// egzekwujemy niżej (maTresc), żeby dać czytelny komunikat 400 zamiast surowego
// błędu walidacji struktury.
const analizaSchema = z.object({
  tekst: z.string().optional(),
  pdf_base64: z.string().optional(),
});

/** Czy żądanie w ogóle niesie treść umowy do analizy (tekst lub plik PDF). */
function maTresc(data) {
  return Boolean(data.tekst?.trim()) || Boolean(data.pdf_base64?.trim());
}

router.post('/analiza', ah(async (req, res) => {
  const parsed = analizaSchema.safeParse(req.body ?? {});
  if (!parsed.success || !maTresc(parsed.data)) {
    throw badRequest('Podaj treść umowy: pole "tekst" (umowa jako tekst) albo "pdf_base64" (plik PDF w base64).');
  }

  // Sprowadzamy wejście (surowy `tekst` albo `pdf_base64`) do jednego,
  // znormalizowanego łańcucha. Zeskanowany/uszkodzony PDF => pusty tekst
  // (nie błąd) — silnik reguł (kolejne podzadanie) dostanie po prostu pustkę.
  const tekst = await ekstrahuj_i_normalizuj(parsed.data);
  res.json({ tekst, flagi: [] });
}));

export default router;
