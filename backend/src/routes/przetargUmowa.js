import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import { ekstrahuj_i_normalizuj } from '../lib/umowaEkstrakcja.js';
import { zbuduj_flagi_umowy } from '../lib/umowaAnaliza.js';

/*
 * Analiza projektu UMOWY przed podpisem (ulepszenie „pilnowanie waloryzacji
 * i pułapek w umowie"). Klient wysyła treść umowy jako surowy `tekst` ALBO
 * `pdf_base64` (plik PDF zakodowany w base64) — i dostaje listę flag: klauzula
 * waloryzacyjna, kary umowne i ich limit, zapisy o odbiorach i podwykonawcach.
 *
 * KONTRAKT ODPOWIEDZI (jednolity, podzadanie 7/12): { tekst, flagi } gdzie
 * `flagi` to lista `[{ typ, kolor, tytul, opis }]` — po jednej fladze na obszar
 * umowy (waloryzacja / kary / odbiory / podwykonawcy), w stałej kolejności,
 * `kolor` ∈ { zielony, pomarańczowy, czerwony }. Scaleniem detektorów w tę listę
 * zajmuje się `zbuduj_flagi_umowy` (lib/umowaAnaliza.js); `tekst` to znormalizowana
 * treść umowy (przydatna np. do podglądu tego, co wyjęto z PDF-a).
 */

const router = Router();

// `tekst`/`pdf_base64` opcjonalne w schemacie — regułę „co najmniej jedno niesie
// treść" egzekwujemy niżej (maTresc), żeby dać czytelny komunikat 400 zamiast
// surowego błędu walidacji struktury. `miesiace` (szacowany czas trwania umowy)
// jest opcjonalny i steruje flagą braku obowiązkowej klauzuli waloryzacyjnej.
const analizaSchema = z.object({
  tekst: z.string().optional(),
  pdf_base64: z.string().optional(),
  miesiace: z.number().optional(),
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
  // (nie błąd) — silnik reguł dostanie po prostu pustkę i zwróci flagi „brak
  // zapisów / do weryfikacji", zamiast się wywrócić.
  const tekst = await ekstrahuj_i_normalizuj(parsed.data);
  const flagi = zbuduj_flagi_umowy(tekst, parsed.data.miesiace);
  res.json({ tekst, flagi });
}));

export default router;
