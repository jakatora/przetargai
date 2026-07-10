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

/**
 * Lista dopasowań użytkownika, paginowana KURSOREM.
 *
 * `?before=<kursor>` — nieprzezroczysty znacznik ostatniego wyświetlonego dopasowania,
 * zwrócony wcześniej jako `next_before`. `null` w odpowiedzi oznacza koniec listy.
 *
 * Dawniej było `?offset=`, ale Firestore nalicza odczyt za każdy pominięty dokument,
 * a wartość podawał klient (audyt 2026-07-10).
 */
router.get('/', ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const przed = typeof req.query.before === 'string' && req.query.before
    ? req.query.before.slice(0, 200) // kursor nie ma prawa być dłuższy — obcinamy zamiast ufać
    : null;

  // Dokumenty niosą zdenormalizowane pola przetargu (bez JOIN-a); publicMatch
  // składa z nich identyczny kształt odpowiedzi jak wersja SQLite.
  const rows = await matches.listForUser(req.user.id, limit, przed);
  audit({ userId: req.user.id, action: 'list_matches', ip: req.ip });

  // Pełna strona ⇒ prawdopodobnie jest kolejna. Krótsza ⇒ to koniec.
  const nastepny = rows.length === limit ? matches.kursorZ(rows[rows.length - 1]) : null;
  res.json({ matches: rows.map(publicMatch), count: rows.length, limit, next_before: nastepny });
}));

/** Szczegóły pojedynczego dopasowania. */
router.get('/:id', ah(async (req, res) => {
  // Firestore: detail(userId, matchId) — kolejność (userId, matchId), a cudzych
  // dopasowań nie da się nawet zaadresować (subkolekcja usera). Zwraca null,
  // gdy nie znaleziono.
  const row = await matches.detail(req.user.id, req.params.id);
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');
  audit({ userId: req.user.id, action: 'view_match', detail: { matchId: row.id }, ip: req.ip });
  res.json({ match: publicMatch(row) });
}));

/** Feedback użytkownika do dopasowania (przydatne / nieprzydatne). */
const feedbackSchema = z.object({ helpful: z.boolean() });

router.post('/:id/feedback', ah(async (req, res) => {
  const result = feedbackSchema.safeParse(req.body);
  if (!result.success) throw badRequest('Wymagane pole "helpful" typu boolean');

  const row = await matches.detail(req.user.id, req.params.id);
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');

  await feedback.upsert({ userId: req.user.id, matchId: row.id, helpful: result.data.helpful });
  audit({
    userId: req.user.id,
    action: 'match_feedback',
    detail: { matchId: row.id, helpful: result.data.helpful },
    ip: req.ip,
  });
  res.json({ ok: true });
}));

export default router;
