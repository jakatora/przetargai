import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { scanFitterIso } from '../services/fitterScan.js';
import { badRequest, serviceUnavailable, tooMany } from '../lib/errors.js';
import { features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { aiQuotaDevice } from '../db/repos.js';

// Vision OCR for ISO drawings. Client posts a base64 image (JSON body, no
// multipart — keeps the dependency surface tight, just bumps the body limit
// for this route via app.js wiring). Response matches AiScanResult envelope
// expected by lib/services/iso_scanner_ai.dart.

const router = Router();

const scanSchema = z.object({
  image_base64: z.string().min(64),         // arbitrary lower bound — guards empty / tiny inputs
  media_type: z.enum(['image/jpeg', 'image/png']).optional(),
  device_id: z.string().min(8).max(128),
});

router.post('/', ah(async (req, res) => {
  if (!features.ai) throw serviceUnavailable('AI niedostępne');
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Wymagane: image_base64 (base64 obrazu), device_id');
  const { image_base64: img, media_type: mt, device_id: deviceId } = parsed.data;

  /*
   * Dobowy limit na urządzenie (audyt 2026-07-10). Trasa jest nieuwierzytelniona,
   * a każdy skan to płatne wywołanie Sonneta z wizją. Darmowe urządzenie dostaje
   * kilka prób dziennie, Premium — tyle, ile potrzeba do pracy. Bez tego jeden
   * skrypt mógł palić budżet AI aż do twardego limitu, gasząc AI także PrzetargAI.
   */
  if (!aiQuotaDevice.reserve(deviceId, 'fitter_scan')) {
    const limit = aiQuotaDevice.limitDlaUrzadzenia(deviceId, 'fitter_scan');
    logger.warn({ deviceId, limit }, 'Fitter scan-iso: dobowy limit urządzenia wyczerpany');
    throw tooMany(`Dzienny limit skanów (${limit}) wyczerpany. Spróbuj jutro albo aktywuj Premium.`);
  }

  const sizeKB = Math.round((img.length * 0.75) / 1024); // base64 → bytes approx
  logger.info({ deviceId, sizeKB }, 'Fitter scan-iso received');

  const envelope = await scanFitterIso({
    imageBase64: img,
    mediaType: mt ?? 'image/jpeg',
    deviceId,
  });
  res.json(envelope);
}));

export default router;
