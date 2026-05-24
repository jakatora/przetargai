import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { adminRequired } from '../middleware/adminAuth.js';
import { runTenderFetch } from '../jobs/fetchTenders.js';
import { createBackup } from '../services/backup.js';
import { tenders, users } from '../db/repos.js';
import { db } from '../db/index.js';
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

/** Ostatnie dopasowania w systemie — diagnostyka i ops (ostatni cron). */
router.get('/recent-matches', ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const rows = db.prepare(`
    SELECT m.id, m.user_id, m.confidence_score, m.match_reasoning, m.scorer, m.created_at,
           u.company_name, u.company_nip,
           t.title AS tender_title, t.organization AS tender_organization,
           t.cpv_main AS tender_cpv, t.url AS tender_url,
           t.budget AS tender_budget, t.currency AS tender_currency,
           t.deadline AS tender_deadline
    FROM matches m
    JOIN tenders t ON t.id = m.tender_id
    JOIN users u   ON u.id = m.user_id
    ORDER BY m.created_at DESC, m.confidence_score DESC
    LIMIT ?`).all(limit);
  res.json({ count: rows.length, matches: rows });
}));

export default router;
