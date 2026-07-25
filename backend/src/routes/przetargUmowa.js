import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';

/*
 * Analiza projektu UMOWY przed podpisem (ulepszenie „pilnowanie waloryzacji
 * i pułapek w umowie"). Klient wysyła treść umowy jako surowy `tekst` ALBO
 * `pdf_base64` (plik PDF zakodowany w base64) — i dostaje listę flag: klauzula
 * waloryzacyjna, kary umowne i ich limit, zapisy o odbiorach i podwykonawcach.
 *
 * PODZADANIE 1/12 — SZKIELET: tylko routing + walidacja wejścia. Silnik reguł
 * (wykrywanie flag) oraz ekstrakcja tekstu z PDF-a dochodzą w kolejnych krokach,
 * dlatego handler zwraca na razie pustą kopertę wyniku { tekst, flagi: [] }.
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

  // Ekstrakcja tekstu z PDF-a to osobne podzadanie — na razie handler oddaje
  // z powrotem przekazany tekst (pusty łańcuch, gdy wejściem był sam PDF).
  const tekst = parsed.data.tekst?.trim() ?? '';
  res.json({ tekst, flagi: [] });
}));

export default router;
