import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { users, tenders, planyPostepowan } from '../db/repos.js';
import { badRequest, notFound } from '../lib/errors.js';
import { zbudujRadar, zbudujSzczegolPlanu } from '../lib/widokRadaru.js';

/*
 * RADAR PLANÓW POSTĘPOWAŃ — „wiedz o przetargu tygodnie przed ogłoszeniem".
 *
 * Dane: wstępne ogłoszenia informacyjne z TED (job `planyOknoFetch`), czytane
 * ze zwartego indeksu — kilka odczytów zamiast skanu kolekcji. Logika: czyste
 * moduły radaru przeniesione z Railway (`lib/radarPlanow.js` i spółka).
 *
 * 🚨 BEZ PŁATNEGO AI. Ranking, plan przygotowań i dopasowanie ogłoszenia do planu
 * są deterministyczne — ekran ma się otwierać bez limitu, jak katalog.
 */

const router = Router();
router.use(authRequired);

const zapytanieListy = z.object({
  tryb: z.enum(['dla_mnie', 'wszystkie']).default('dla_mnie'),
  region: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const dzisiajUtc = () => new Date().toISOString().slice(0, 10);

router.get('/', ah(async (req, res) => {
  const parsed = zapytanieListy.safeParse(req.query);
  if (!parsed.success) throw badRequest('Niepoprawne parametry radaru', parsed.error.issues);

  const [user, indeks] = await Promise.all([users.findById(req.user.id), planyPostepowan.indeks()]);
  const radar = zbudujRadar({
    wpisy: indeks.wpisy,
    uzytkownik: user,
    dzisiaj: dzisiajUtc(),
    ...parsed.data,
  });
  res.json({
    ...radar,
    zbudowano_o: indeks.zbudowano_o,
    zrodlo: {
      kod: 'ted_planowanie',
      pl: 'Wstępne ogłoszenia informacyjne z TED — zamówienia powyżej progów unijnych. Planów z BZP (art. 23 Pzp) nie udostępnia publiczne API.',
      en: 'Prior information notices from TED — contracts above EU thresholds. BZP procurement plans (art. 23) are not available via a public API.',
    },
  });
}));

router.get('/:id', ah(async (req, res) => {
  const pozycja = await planyPostepowan.pobierz(req.params.id);
  if (!pozycja) throw notFound('Pozycja planu nie została znaleziona');

  const [user, przetargi] = await Promise.all([
    users.findById(req.user.id),
    tenders.poNipieZamawiajacego(pozycja.zamawiajacy_nip),
  ]);
  res.json(zbudujSzczegolPlanu({ pozycja, uzytkownik: user, dzisiaj: dzisiajUtc(), przetargi }));
}));

export default router;
