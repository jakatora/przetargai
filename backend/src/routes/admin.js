import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { adminRequired } from '../middleware/adminAuth.js';
import { runTenderFetch } from '../jobs/fetchTenders.js';
import { createBackup } from '../services/backup.js';
import { tenders, users } from '../db/repos.js';
import { budgetStatus } from '../services/ai.js';

const router = Router();
router.use(adminRequired);

/** Ręczne uruchomienie pobierania przetargów z BZP + matchingu. */
router.post('/fetch-tenders', ah(async (req, res) => {
  const pages = Math.min(Math.max(Number(req.query.pages) || 1, 1), 10);
  const result = await runTenderFetch({ pages });
  res.json(result);
}));

/** Podstawowe statystyki systemu. */
router.get('/stats', ah(async (req, res) => {
  res.json({
    users: users.all().length,
    tenders: tenders.count(),
    ai_budget: budgetStatus(),
  });
}));

/** Stan budżetu AI (limit miękki / twardy). */
router.get('/ai-budget', ah(async (req, res) => {
  res.json(budgetStatus());
}));

/** Ręczne utworzenie zaszyfrowanej kopii zapasowej bazy. */
router.post('/backup', ah(async (req, res) => {
  const result = await createBackup();
  res.json(result);
}));

export default router;
