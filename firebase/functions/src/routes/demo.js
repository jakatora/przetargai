import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { users, tenders } from '../db/repos.js';
import { generateMatchesForUser } from '../services/matching.js';
import { publicUser } from '../lib/serialize.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/*
 * PRZEŁĄCZNIK PLANÓW DEMO (D-040) — do oglądania różnicy między pakietami
 * bez przechodzenia przez Stripe.
 *
 * ⚠️ BEZPIECZEŃSTWO: ten router jest montowany w app.js WYŁĄCZNIE poza
 * produkcją (env.NODE_ENV !== 'production'). Na produkcji darmowe konto
 * nadałoby sobie Standard jednym żądaniem. Strażnik montowania pilnuje
 * test/demoTierProdukcja.test.js — NIE montować bezwarunkowo.
 */

const router = Router();
router.use(authRequired);

const schemat = z.object({ tier: z.enum(['free', 'standard']) });

router.post('/tier', ah(async (req, res) => {
  const wynik = schemat.safeParse(req.body);
  if (!wynik.success) throw badRequest('Wymagane pole "tier": free | standard');
  const { tier } = wynik.data;

  await users.setTier(req.user.id, tier);
  const swiezy = await users.findById(req.user.id);

  /*
   * Od razu przeliczamy dopasowania, żeby różnica pakietów była WIDOCZNA
   * w feedzie bez czekania na cron: Standard dosypuje wszystko powyżej progu,
   * Free pokazuje działanie limitu dziennego (nadwyżka odroczona na jutro).
   * Celowo BEZ cooldownu backfillu — to tryb demo, przełączany wielokrotnie.
   */
  let matchesCreated = 0;
  try {
    const pula = await tenders.openPool();
    ({ created: matchesCreated } = await generateMatchesForUser(swiezy, pula));
  } catch (err) {
    // Feed pokaże stare dane — przełączenie planu i tak się udało.
    logger.error({ err: err.message, userId: swiezy.id }, 'Demo: przeliczenie dopasowań nie powiodło się');
  }

  logger.info({ userId: swiezy.id, tier, matchesCreated }, 'Demo: przełączono plan');
  res.json({ user: publicUser(swiezy), matchesCreated });
}));

export default router;
