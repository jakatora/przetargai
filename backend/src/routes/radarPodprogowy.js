import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { createPodprogoweRepo } from '../db/podprogoweRepo.js';
import { createPreferencjeRadaruRepo } from '../db/preferencjeRadaruRepo.js';
import WSZYSTKIE_ADAPTERY from '../services/adaptery/index.js';
import { uzupelnijRegulamin } from '../services/regulaminZakupowy.js';
import { odswiezPreferencje } from '../jobs/monitorPodprogowy.js';

/*
 * RADAR ZAMÓWIEŃ PODPROGOWYCH — endpointy (ulepszenie „Radar zamówień podprogowych —
 * poniżej 170 tys. zł", podzadanie 6/7). Samodzielny router, spójny ze wzorcem
 * scheduler/endpoint z Radaru SWZ (routes/radarSwz.js + jobs/monitorSwz.js):
 *
 *   • GET    /preferencje         — preferencje radaru zalogowanego użytkownika,
 *   • POST   /preferencje         — zapis (upsert) preferencji branża/region/próg,
 *   • DELETE /preferencje/:id     — usunięcie preferencji (skopowane do właściciela),
 *   • GET    /ogloszenia          — SCALONY strumień z filtrami (branża/region/próg/
 *                                   tylko `latwiejszy_start`), stronicowany,
 *   • GET    /ogloszenia/:id      — szczegóły znaleziska WRAZ z regulaminem zakupowym,
 *   • POST   /odswiez             — RĘCZNY trigger odświeżenia (odpowiednik cyklicznego
 *                                   monitora): uruchamia adaptery dla preferencji usera
 *                                   (albo doraźnej branży/regionu z body) i domawia regulaminy.
 *
 * REPOZYTORIA to samodzielne fabryki na singletonie `db` (podprogoweRepo /
 * preferencjeRadaruRepo) — świadomie, bo repos.js ma niezacommitowany WIP innych
 * funkcji (pułapka drzewa roboczego z pamięci projektu).
 *
 * ŚCIEŻKA PIENIĘDZY: /odswiez odpala płatne AI (streszczenie regulaminu) WYŁĄCZNIE dla
 * nowo dodanych ogłoszeń, przez wspólną bramkę budżetu w usłudze regulaminu (gracja
 * przy AI-down/wyczerpaniu = sam URL). Trasa jest UWIERZYTELNIONA (nie anonimowa) i
 * montowana pod limiterem API — bramka budżetu w usłudze jest ostatnią linią obrony.
 * Odczyty (preferencje/lista/szczegóły) są czyste — bez AI.
 */

const router = Router();
const repo = createPodprogoweRepo(db);
const prefRepo = createPreferencjeRadaruRepo(db);

/*
 * Test seam (jak `ustawKlientaAnthropic` w usługach AI): pozwala testom podstawić
 * atrapy adapterów i usługi regulaminu, żeby /odswiez nie ruszał sieci ani płatnego AI.
 */
let _adaptery = WSZYSTKIE_ADAPTERY;
let _uzupelnij = uzupelnijRegulamin;
export function ustawZrodlaOdswiezania({ adaptery, uzupelnij } = {}) {
  if (adaptery) _adaptery = adaptery;
  if (uzupelnij) _uzupelnij = uzupelnij;
}

// ── Preferencje radaru ───────────────────────────────────────────────────────

const prefSchema = z.object({
  branza: z.string().max(200).optional(),
  region: z.string().max(200).optional(),
  prog_netto: z.coerce.number().positive().max(100_000_000).optional(),
});

router.get('/preferencje', authRequired, ah(async (req, res) => {
  res.json({ preferencje: prefRepo.listForUser(req.user.id) });
}));

router.post('/preferencje', authRequired, ah(async (req, res) => {
  const parsed = prefSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Podaj "branza"/"region" (tekst) i opcjonalnie "prog_netto" (liczba > 0).');
  const branza = (parsed.data.branza ?? '').trim();
  const region = (parsed.data.region ?? '').trim();
  // Preferencja bez branży i regionu łapałaby wszystko — wymagamy co najmniej jednej.
  if (!branza && !region) throw badRequest('Podaj co najmniej branżę lub region do monitorowania.');

  const preferencja = prefRepo.upsert({
    userId: req.user.id,
    branza,
    region,
    progNetto: parsed.data.prog_netto,
  });
  res.status(201).json({ preferencja });
}));

router.delete('/preferencje/:id', authRequired, ah(async (req, res) => {
  const usunieto = prefRepo.remove(req.params.id, req.user.id);
  if (!usunieto) throw notFound('Nie znaleziono preferencji radaru o podanym id.');
  res.status(200).json({ usunieto: true });
}));

// ── Scalony strumień ogłoszeń ────────────────────────────────────────────────

/** Czy wartość query wygląda na „prawdę" (1/true/tak). */
function prawda(v) {
  return ['1', 'true', 'tak', 'yes'].includes(String(v ?? '').trim().toLowerCase());
}

router.get('/ogloszenia', authRequired, ah(async (req, res) => {
  const q = req.query ?? {};
  const branza = typeof q.branza === 'string' ? q.branza.trim() : '';
  const region = typeof q.region === 'string' ? q.region.trim() : '';

  let prog;
  if (q.prog !== undefined && String(q.prog).trim() !== '') {
    prog = Number(q.prog);
    if (!Number.isFinite(prog) || prog <= 0) throw badRequest('"prog" musi być dodatnią liczbą.');
  }
  const tylkoLatwiejszyStart = prawda(q.latwiejszy_start);

  let limit = q.limit !== undefined ? Number(q.limit) : 50;
  if (!Number.isFinite(limit)) throw badRequest('"limit" musi być liczbą.');
  let offset = q.offset !== undefined ? Number(q.offset) : 0;
  if (!Number.isFinite(offset) || offset < 0) throw badRequest('"offset" musi być liczbą ≥ 0.');

  const ogloszenia = repo.list({ branza, region, prog, tylkoLatwiejszyStart, limit, offset });
  res.json({
    ogloszenia,
    filtry: { branza: branza || null, region: region || null, prog: prog ?? null, tylko_latwiejszy_start: tylkoLatwiejszyStart },
  });
}));

router.get('/ogloszenia/:id', authRequired, ah(async (req, res) => {
  const ogloszenie = repo.byId(req.params.id);
  if (!ogloszenie) throw notFound('Nie znaleziono ogłoszenia podprogowego o podanym id.');
  res.json({ ogloszenie });
}));

// ── Ręczne odświeżenie ───────────────────────────────────────────────────────

const odswiezSchema = z.object({
  branza: z.string().max(200).optional(),
  region: z.string().max(200).optional(),
  prog_netto: z.coerce.number().positive().max(100_000_000).optional(),
});

router.post('/odswiez', authRequired, ah(async (req, res) => {
  const parsed = odswiezSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Nieprawidłowe dane odświeżenia (branza/region/prog_netto).');

  const adHocBranza = (parsed.data.branza ?? '').trim();
  const adHocRegion = (parsed.data.region ?? '').trim();

  // Body z branżą/regionem => doraźna preferencja (jednorazowe odświeżenie bez
  // zapisu); inaczej odświeżamy zapisane preferencje użytkownika.
  let preferencje;
  if (adHocBranza || adHocRegion) {
    preferencje = [{ branza: adHocBranza, region: adHocRegion, prog_netto: parsed.data.prog_netto ?? 170000 }];
  } else {
    preferencje = prefRepo.listForUser(req.user.id);
  }
  if (!preferencje.length) {
    throw badRequest('Brak preferencji radaru do odświeżenia — zapisz branżę/region albo podaj je w żądaniu.');
  }

  const wyniki = [];
  for (const pref of preferencje) {
    wyniki.push(await odswiezPreferencje({ pref, repo, adaptery: _adaptery, uzupelnij: _uzupelnij }));
  }
  const dodano = wyniki.reduce((s, w) => s + w.dodano, 0);
  const regulaminy = wyniki.reduce((s, w) => s + w.regulaminy, 0);
  res.status(200).json({ odswiezono: preferencje.length, dodano, regulaminy, wyniki });
}));

export default router;
