import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { tenders } from '../db/repos.js';

/**
 * Publiczne statystyki (BEZ logowania) — dowód społeczny na ekranie logowania/rejestracji.
 * „Dziś przybyło N przetargów, w bazie jest M" zwiększa konwersję rejestracji (FOMO +
 * dowód, że aplikacja żyje). Zwraca wyłącznie liczby zagregowane — zero danych osobowych.
 */
const router = Router();

router.get('/public', ah(async (req, res) => {
  const teraz = Date.now();
  const doba = new Date(teraz - 24 * 60 * 60 * 1000).toISOString();
  const tydzien = new Date(teraz - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [lacznie, nowe24h, nowe7dni] = await Promise.all([
    tenders.count(),
    tenders.countSince(doba),
    tenders.countSince(tydzien),
  ]);

  res.json({ lacznie, nowe24h, nowe7dni });
}));

export default router;
