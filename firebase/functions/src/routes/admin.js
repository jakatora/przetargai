import { Router } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ah } from '../lib/asyncHandler.js';
import { adminRequired } from '../middleware/adminAuth.js';
import { runTenderFetch } from '../jobs/fetchTenders.js';
import { backfillUser } from '../services/matching.js';
import { tenders, users } from '../db/repos.js';
import { budgetStatus } from '../services/ai.js';
import { notFound, serviceUnavailable } from '../lib/errors.js';

const router = Router();
router.use(adminRequired);

/**
 * Ręczne uruchomienie pobierania przetargów z BZP + matchingu.
 * BZP ma zepsutą paginację (PageNumber ignorowany) — zamiast wielu stron sterujemy
 * rozmiarem JEDNEGO zapytania przez `pageSize` (runTenderFetch nie przyjmuje `pages`).
 */
router.post('/fetch-tenders', ah(async (req, res) => {
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 500, 1), 500);
  const result = await runTenderFetch({ pageSize });
  res.json(result);
}));

/** Podstawowe statystyki systemu. */
router.get('/stats', ah(async (req, res) => {
  const [allUsers, tenderCount, aiBudget] = await Promise.all([
    users.all(),
    tenders.count(),
    budgetStatus({ swiezy: true }),
  ]);
  res.json({
    users: allUsers.length,
    tenders: tenderCount,
    ai_budget: aiBudget,
  });
}));

/** Stan budżetu AI (limit miękki / twardy). */
router.get('/ai-budget', ah(async (req, res) => {
  res.json(await budgetStatus({ swiezy: true }));
}));

/**
 * Ręczna kopia zapasowa — NIE dotyczy Firestore.
 * Na Railway był to VACUUM INTO bazy SQLite + szyfrowanie + wysyłka do Backblaze B2.
 * Firestore jest zarządzany: kopie robi platforma (PITR / zaplanowane eksporty do GCS),
 * a zmienne BACKUP_ i B2_ zniknęły z konfiguracji (D-024). Endpoint zostaje w API,
 * ale świadomie zgłasza, że ręczny backup aplikacyjny nie ma tu zastosowania.
 */
router.post('/backup', ah(async () => {
  throw serviceUnavailable('Kopie zapasowe są zarządzane przez Firestore/Google Cloud (PITR / eksporty GCS) — ręczny backup aplikacyjny nie dotyczy tej platformy.');
}));

/** Ostatni zarejestrowani userzy — diagnostyka (czy profile sensowne). */
router.get('/users', ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  // Firestore trzyma keywords/cpv_codes jako natywne tablice (nie JSON string).
  // Rzutujemy JAWNIE wybrane pola — bez tego wyciekłby password_hash i identyfikatory Stripe.
  const rows = (await users.all())
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
    .map((u) => ({
      id: u.id,
      email: u.email,
      company_name: u.company_name,
      company_nip: u.company_nip,
      premium_tier: u.premium_tier,
      keywords: u.keywords ?? [],
      cpv_codes: u.cpv_codes ?? [],
      created_at: u.created_at,
      has_push_token: Boolean(u.push_token),
    }));
  res.json({ count: rows.length, users: rows });
}));

/** Backfill — matching usera vs pula kandydatów (otwarty termin, bez dopasowania). */
router.post('/match-user/:userId', ah(async (req, res) => {
  const user = await users.findById(req.params.userId);
  if (!user) throw notFound('Użytkownik nie istnieje');
  const result = await backfillUser(user, { wymus: true });
  res.json({
    ok: true,
    user_id: user.id,
    evaluated: result.evaluated,
    matchesCreated: result.created,
  });
}));

/**
 * Ostatnie dopasowania w systemie — diagnostyka i ops (ostatni cron).
 *
 * Bez JOIN-ów: pola przetargu są ZDENORMALIZOWANE w dokumencie dopasowania
 * (tender_title, tender_budget, tender_deadline...). collectionGroup zbiera
 * dopasowania ze wszystkich subkolekcji users/{uid}/matches naraz — wymaga indeksu
 * collection-group po `created_at` (firestore.indexes.json). Nazwę/NIP firmy
 * dobieramy z profilu: jeden odczyt na UNIKALNEGO usera, nie na dopasowanie.
 */
router.get('/recent-matches', ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const snap = await getFirestore()
    .collectionGroup('matches')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const profiles = new Map(
    (await Promise.all(userIds.map((id) => users.findById(id))))
      .filter(Boolean)
      .map((u) => [u.id, u]),
  );

  const matches = rows
    // Odpowiednik SQL ORDER BY created_at DESC, confidence_score DESC.
    .sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at))
      || (b.confidence_score - a.confidence_score))
    .map((m) => {
      const u = profiles.get(m.user_id);
      return {
        id: m.id,
        user_id: m.user_id,
        confidence_score: m.confidence_score,
        match_reasoning: m.match_reasoning,
        scorer: m.scorer,
        created_at: m.created_at,
        company_name: u?.company_name ?? null,
        company_nip: u?.company_nip ?? null,
        tender_title: m.tender_title,
        tender_organization: m.tender_organization,
        tender_cpv: m.tender_cpv,
        tender_url: m.tender_url,
        tender_budget: m.tender_budget,
        tender_currency: m.tender_currency,
        tender_deadline: m.tender_deadline,
      };
    });

  res.json({ count: matches.length, matches });
}));

export default router;
