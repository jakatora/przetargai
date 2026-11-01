import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { tenders, limitKontroliOferty } from '../db/repos.js';
import { AppError, tooMany } from '../lib/errors.js';
import { kontrolujPlikiOferty } from '../lib/kontrolaPlikowOferty.js';
import { liniePdf } from '../services/tekstPdf.js';
import { zapiszPoAnalizieSwz } from '../services/zapisPoAnalizie.js';

/*
 * Kontrola plików oferty przed wysłaniem (2026-10-31): wykonawca wysyła gotowe pliki (base64),
 * dostaje raport — podpisy, niewypełnione miejsca, NIP-y, kwoty brutto i listę tego, czego nie
 * sprawdziliśmy. Bez AI i bez zapisu plików (tylko pamięć żądania). Dobowy limit chroni CPU instancji.
 * Body do 20 MB parsuje osobny `express.json` zamontowany przed globalnym (1 MB) w app.js.
 */
export const LIMIT_KONTROLI_DZIENNIE = 30;

const router = Router();
router.use(authRequired);

router.post('/kontrola', ah(async (req, res) => {
  const { tender_id: tenderId = null, pliki } = req.body ?? {};
  const tender = tenderId ? await tenders.findById(String(tenderId)).catch(() => null) : null;
  if (!(await limitKontroliOferty.zarezerwuj(req.user.id, LIMIT_KONTROLI_DZIENNIE))) {
    throw tooMany(`Dzienny limit kontroli (${LIMIT_KONTROLI_DZIENNIE}) wyczerpany — spróbuj jutro.`);
  }
  try {
    const raport = await kontrolujPlikiOferty(
      { pliki, firma: { nip: req.user.company_nip ?? null }, zamawiajacyNip: tender?.zamawiajacy_nip ?? null },
      { tekstPdf: liniePdf },
    );
    // Kontrola plików przed wysłaniem = oferta prawie gotowa: przetarg do Zapisanych z przypomnieniem.
    const zapis = tender ? await zapiszPoAnalizieSwz(req.user.id, tender) : { zapisany: false };
    res.json({ tender_id: tender?.id ?? null, ...raport, zapisano: zapis.zapisany });
  } catch (err) {
    if (err.status) throw new AppError(err.status, err.status === 413 ? 'ZA_DUZO' : 'BAD_REQUEST', err.message);
    throw err;
  }
}));

export default router;
