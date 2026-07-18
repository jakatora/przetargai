import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { matches, feedback, saved, tenders, streszczenieQuota, wynikiStats } from '../db/repos.js';
import { kluczWyniku } from '../lib/wynikiAgregacja.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publicMatch, publicSaved } from '../lib/serialize.js';
import { summarizeTender } from '../services/ai.js';
import { normalizujStatus, oczyscNotatke, STATUSY } from '../lib/statusPrzetargu.js';
import { zbudujZachete, POCZATEK_TYGODNIA_MS } from '../lib/potencjal.js';
import { env } from '../config.js';

/** Dobowy limit NOWYCH generacji wyjaśnień AI na użytkownika (cache miss). */
const LIMIT_STRESZCZEN_DZIENNIE = { free: 8, standard: 60 };

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

/**
 * Lista zapisanych przetargów (zakładki) — D-049.
 * MUSI stać PRZED `GET /:id`, inaczej Express dopasowałby /saved jako id="saved".
 */
router.get('/saved', ah(async (req, res) => {
  const rows = await saved.list(req.user.id);
  res.json({ saved: rows.map(publicSaved), count: rows.length });
}));

/** Same identyfikatory zapisanych — do zaznaczania ikony zakładki w feedzie. */
router.get('/saved/ids', ah(async (req, res) => {
  res.json({ ids: await saved.ids(req.user.id) });
}));

/**
 * Statystyki + zachęta do Standard (D-055 — FOMO na Free). Zwraca REALNE liczby
 * (dopasowania dziś / w tym tygodniu) i gotowy komunikat zachęty dla planu Free.
 * MUSI stać przed `GET /:id` (inaczej „statystyki" byłoby id dopasowania).
 */
router.get('/statystyki', ah(async (req, res) => {
  const tydzienTemu = new Date(Date.now() - POCZATEK_TYGODNIA_MS).toISOString();
  const [dzis, wTymTygodniu] = await Promise.all([
    matches.countToday(req.user.id),
    matches.countSince(req.user.id, tydzienTemu),
  ]);
  const zacheta = zbudujZachete({
    isFree: req.user.premium_tier === 'free',
    dzis,
    wTymTygodniu,
    limitDzienny: env.FREE_TIER_DAILY_MATCH_LIMIT,
  });
  res.json({ dzis, w_tym_tygodniu: wTymTygodniu, limit_dzienny: env.FREE_TIER_DAILY_MATCH_LIMIT, zacheta });
}));

/** Zapisuje przetarg do zakładek (idempotentnie). Kopiuje pola z dopasowania. */
router.put('/:id/save', ah(async (req, res) => {
  const row = await matches.detail(req.user.id, req.params.id);
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');
  const created = await saved.add(req.user.id, row);
  audit({ userId: req.user.id, action: 'save_tender', detail: { tenderId: row.id }, ip: req.ip });
  res.json({ saved: true, created });
}));

/** Usuwa przetarg z zakładek. */
router.delete('/:id/save', ah(async (req, res) => {
  await saved.remove(req.user.id, req.params.id);
  audit({ userId: req.user.id, action: 'unsave_tender', detail: { tenderId: req.params.id }, ip: req.ip });
  res.json({ saved: false });
}));

/**
 * Włącza/wyłącza przypomnienie o terminie dla ZAPISANEGO przetargu (D-050).
 * Przetarg musi być wcześniej w zakładkach; bez terminu zwracamy powód.
 */
const reminderSchema = z.object({ enabled: z.boolean() });
router.put('/:id/reminder', ah(async (req, res) => {
  const wynik = reminderSchema.safeParse(req.body);
  if (!wynik.success) throw badRequest('Wymagane pole "enabled" typu boolean');

  const stan = await saved.setReminder(req.user.id, req.params.id, wynik.data.enabled);
  if (stan.powod === 'nie_zapisany') throw notFound('Najpierw zapisz ten przetarg');
  audit({ userId: req.user.id, action: 'set_reminder', detail: { tenderId: req.params.id, enabled: stan.reminder_enabled }, ip: req.ip });
  res.json(stan);
}));

/**
 * Ustawia etap pracy nad zapisanym przetargiem (D-054 — warsztat przetargu).
 * MUSI stać przed `GET /:id`. Przetarg musi być wcześniej zapisany.
 */
const statusSchema = z.object({ status: z.string() });
router.put('/:id/status', ah(async (req, res) => {
  const wynik = statusSchema.safeParse(req.body);
  if (!wynik.success) throw badRequest('Wymagane pole "status"');
  const status = normalizujStatus(wynik.data.status);
  const stan = await saved.setStatus(req.user.id, req.params.id, status);
  if (!stan) throw notFound('Najpierw zapisz ten przetarg');
  audit({ userId: req.user.id, action: 'set_status', detail: { tenderId: req.params.id, status }, ip: req.ip });
  res.json({ status, dostepne: STATUSY });
}));

/** Zapisuje prywatną notatkę do zapisanego przetargu (D-054). */
const notatkaSchema = z.object({ notatka: z.string() });
router.put('/:id/notatka', ah(async (req, res) => {
  const wynik = notatkaSchema.safeParse(req.body);
  if (!wynik.success) throw badRequest('Wymagane pole "notatka"');
  const notatka = oczyscNotatke(wynik.data.notatka);
  const stan = await saved.setNote(req.user.id, req.params.id, notatka);
  if (!stan) throw notFound('Najpierw zapisz ten przetarg');
  audit({ userId: req.user.id, action: 'set_note', detail: { tenderId: req.params.id }, ip: req.ip });
  res.json({ notatka });
}));

/**
 * Wyjaśnienie AI ogłoszenia (D-052). Kolejność MUSI być przed `GET /:id`.
 *
 * Ścieżka: cache na przetargu (wspólny) → gdy brak: rezerwacja dobowego limitu
 * generacji użytkownika → generacja (budżetowana w services/ai) → zapis cache.
 * `id` to identyfikator dopasowania; przez matches.detail sprawdzamy własność
 * (IDOR-odporność) i wyciągamy tender_id, po czym wyjaśnienie żyje na przetargu.
 */
router.get('/:id/streszczenie', ah(async (req, res) => {
  const row = await matches.detail(req.user.id, req.params.id);
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');
  const tenderId = row.tender_id;

  const zCache = await tenders.getSummary(tenderId);
  if (zCache) {
    res.json({ streszczenie: zCache, cached: true });
    return;
  }

  const limit = LIMIT_STRESZCZEN_DZIENNIE[req.user.premium_tier] ?? LIMIT_STRESZCZEN_DZIENNIE.free;
  if (!await streszczenieQuota.reserve(req.user.id, limit)) {
    res.json({
      streszczenie: null,
      powod: 'limit_dzienny',
      komunikat: `Wykorzystano dzienny limit wyjaśnień (${limit}). Spróbuj jutro lub rozważ wyższy plan.`,
    });
    return;
  }

  // Do wyjaśnienia bierzemy PEŁNY dokument przetargu (cpv_main, budget…), nie
  // zdenormalizowany wiersz dopasowania — findById zwraca komplet pól.
  const tender = await tenders.findById(tenderId) ?? {
    title: row.tender_title, organization: row.tender_organization,
    cpv_main: row.tender_cpv, budget: row.tender_budget, currency: row.tender_currency,
    deadline: row.tender_deadline,
  };

  const streszczenie = await summarizeTender(tender, { userId: req.user.id });
  if (!streszczenie) {
    res.json({
      streszczenie: null,
      powod: 'niedostepne',
      komunikat: 'Nie udało się teraz wygenerować wyjaśnienia. Spróbuj ponownie za chwilę.',
    });
    return;
  }

  await tenders.saveSummary(tenderId, streszczenie);
  audit({ userId: req.user.id, action: 'tender_summary', detail: { tenderId }, ip: req.ip });
  res.json({ streszczenie, cached: false });
}));

/**
 * Statystyki wyników dla przetargu (R17): „za taką robotę w regionie płacono X–Y,
 * startowało ~N firm, w Z% wygrywał mały". Dopasowanie po (dział CPV, rodzaj,
 * województwo). MUSI stać przed `GET /:id`. Zwraca { wyniki: null }, gdy brak danych.
 */
router.get('/:id/wyniki', ah(async (req, res) => {
  const row = await matches.detail(req.user.id, req.params.id);
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');

  const tender = await tenders.findById(row.tender_id);
  const klucz = tender ? kluczWyniku(tender) : null;
  if (!klucz) { res.json({ wyniki: null, powod: 'brak_wymiarow' }); return; }

  const stat = await wynikiStats.pobierz(klucz);
  res.json({ wyniki: stat ?? null, powod: stat ? undefined : 'brak_danych' });
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
