import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { matches, feedback } from '../db/repos.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publicMatch } from '../lib/serialize.js';

const router = Router();
router.use(authRequired);

/** Lista dopasowań użytkownika (paginacja). */
router.get('/', ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = matches.listForUser(req.user.id, { limit, offset });
  audit({ userId: req.user.id, action: 'list_matches', ip: req.ip });
  res.json({ matches: rows.map(publicMatch), count: rows.length, limit, offset });
}));

/** Szczegóły pojedynczego dopasowania. */
router.get('/:id', ah(async (req, res) => {
  const row = matches.detailForUser(req.params.id, req.user.id);
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');
  audit({ userId: req.user.id, action: 'view_match', detail: { matchId: row.id }, ip: req.ip });
  res.json({ match: publicMatch(row) });
}));

/** Feedback użytkownika do dopasowania (przydatne / nieprzydatne). */
const feedbackSchema = z.object({ helpful: z.boolean() });

router.post('/:id/feedback', ah(async (req, res) => {
  const result = feedbackSchema.safeParse(req.body);
  if (!result.success) throw badRequest('Wymagane pole "helpful" typu boolean');

  const row = matches.detailForUser(req.params.id, req.user.id);
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');

  feedback.upsert({ userId: req.user.id, matchId: row.id, helpful: result.data.helpful });
  audit({
    userId: req.user.id,
    action: 'match_feedback',
    detail: { matchId: row.id, helpful: result.data.helpful },
    ip: req.ip,
  });
  res.json({ ok: true });
}));

export default router;
