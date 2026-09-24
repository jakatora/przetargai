import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { users, tenders, planyPostepowan, obserwacjePlanow } from '../db/repos.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { zbudujRadar, zbudujSzczegolPlanu } from '../lib/widokRadaru.js';
import { wpisObserwacji, LIMIT_OBSERWOWANYCH } from '../lib/obserwacjePlanow.js';

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

/**
 * Obserwowane plany konta. Trasa PRZED `/:id` — inaczej Express wziąłby
 * „obserwowane" za numer publikacji.
 */
router.get('/obserwowane', ah(async (req, res) => {
  const lista = await obserwacjePlanow.lista(req.user.id);
  res.json({ obserwowane: lista, limit: LIMIT_OBSERWOWANYCH });
}));

/**
 * Włącza obserwację: monitoring (co 2 h) wyśle alert, gdy zamawiający ogłosi
 * przetarg pasujący do planu z pewnością „pewne". Idempotentne — drugi klik
 * zwraca tę samą obserwację (200 zamiast 201).
 */
router.post('/:id/obserwuj', ah(async (req, res) => {
  const pozycja = await planyPostepowan.pobierz(req.params.id);
  if (!pozycja) throw notFound('Pozycja planu nie została znaleziona');
  const wynik = await obserwacjePlanow.dodaj(
    req.user.id, wpisObserwacji(pozycja, new Date().toISOString()), LIMIT_OBSERWOWANYCH,
  );
  if (wynik.limit) {
    throw conflict(`Możesz obserwować najwyżej ${LIMIT_OBSERWOWANYCH} planów — usuń któryś, żeby dodać nowy.`,
      { kod: 'limit_obserwacji', limit: LIMIT_OBSERWOWANYCH });
  }
  res.status(wynik.nowa ? 201 : 200).json({
    obserwacja: wynik.obserwacja,
    // Bez NIP-u monitoring nie ma po czym złączyć planu z ogłoszeniem — mówimy to od razu.
    ostrzezenie: pozycja.zamawiajacy_nip ? null : {
      kod: 'brak_nip',
      pl: 'Plan nie podaje NIP-u zamawiającego, więc alert może nie przyjść. Sprawdzaj radar ręcznie.',
      en: 'The plan does not state the buyer tax ID, so the alert may not arrive. Check the radar manually.',
    },
  });
}));

router.delete('/:id/obserwuj', ah(async (req, res) => {
  const usunieta = await obserwacjePlanow.usun(req.user.id, req.params.id);
  if (!usunieta) throw notFound('Ten plan nie jest obserwowany');
  res.json({ ok: true });
}));

router.get('/:id', ah(async (req, res) => {
  const pozycja = await planyPostepowan.pobierz(req.params.id);
  if (!pozycja) throw notFound('Pozycja planu nie została znaleziona');

  const [user, przetargi, obserwowany] = await Promise.all([
    users.findById(req.user.id),
    tenders.poNipieZamawiajacego(pozycja.zamawiajacy_nip),
    obserwacjePlanow.czyObserwowany(req.user.id, pozycja.id),
  ]);
  res.json({
    ...zbudujSzczegolPlanu({ pozycja, uzytkownik: user, dzisiaj: dzisiajUtc(), przetargi }),
    obserwowany,
  });
}));

export default router;
