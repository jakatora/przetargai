import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { tenders, users, benchmarkRynku } from '../db/repos.js';
import { badRequest, notFound } from '../lib/errors.js';
import { zbudujChecklisteOferty } from '../lib/checklistaOferty.js';
import { zbudujKalendarz } from '../lib/kalendarzPrzetargu.js';
import { zbudujKarteStartu, kluczeBenchmarku, rozstrzygniecieTegoPostepowania } from '../services/kartaStartu.js';

/*
 * Wygrywalność (etap 6) — „czy warto tu startować" i benchmark rynku.
 *
 * Osobno od `/tenders`, bo katalog jest z zasady BEZSTANOWY (nie czyta profilu),
 * a ta karta profil czyta: maksymalna wartość kontraktu decyduje o tym, czy
 * typowa cena w tej grupie jest dla firmy osiągalna, czy poza zasięgiem.
 *
 * 🚨 BEZ PŁATNEGO AI. Karta ma się otwierać przy każdym ogłoszeniu, tak jak
 * katalog, więc musi być darmowa w odczycie: jeden `getAll` po gotowe kubełki
 * benchmarku, liczone w jobie `benchmarkPrzelicz`.
 */

const router = Router();
router.use(authRequired);

/** Pola profilu, które wchodzą do karty. Reszta profilu jej nie dotyczy. */
function profilDoKarty(user) {
  return { wartosc_max: user?.wartosc_max ?? null, regiony: user?.regiony ?? null };
}

/**
 * Karta „Czy warto startować?" dla przetargu z katalogu.
 *
 * Gdy postępowanie ma już rozstrzygnięcie, oddajemy je zamiast karty — nie ma
 * czego rozważać, a pokazywanie czynników sugerowałoby, że jeszcze można złożyć.
 */
router.get('/tender/:id', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');

  const [user, rozstrzygniecie] = await Promise.all([
    users.findById(req.user.id),
    rozstrzygniecieTegoPostepowania(tender),
  ]);

  if (rozstrzygniecie) {
    res.json({
      stan: 'rozstrzygniete',
      rozstrzygniecie: {
        zrodlo: rozstrzygniecie.zrodlo,
        opublikowano: rozstrzygniecie.opublikowano,
        czesci: rozstrzygniecie.czesci ?? [],
      },
      karta: null,
    });
    return;
  }

  const karta = await zbudujKarteStartu({
    tender, profil: profilDoKarty(user), teraz: Date.now(),
  });
  res.json({ stan: 'otwarte', karta, rozstrzygniecie: null });
}));

/**
 * Surowe kubełki benchmarku dla przetargu — zamawiający, dział w regionie, dział w kraju.
 *
 * Karta oddaje WNIOSEK; to jest materiał, z którego powstał. Bez tego ekranu
 * „skąd to wiecie" nie da się odpowiedzieć niczym poza „zaufaj nam".
 */
router.get('/tender/:id/benchmark', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');

  const klucze = kluczeBenchmarku(tender);
  const kubelki = await benchmarkRynku.pobierzWiele(Object.values(klucze));
  res.json({
    klucze,
    benchmark: {
      zamawiajacy: klucze.zamawiajacy ? kubelki[klucze.zamawiajacy] ?? null : null,
      dzial_region: klucze.dzialRegion ? kubelki[klucze.dzialRegion] ?? null : null,
      dzial_kraj: klucze.dzialKraj ? kubelki[klucze.dzialKraj] ?? null : null,
    },
  });
}));

/*
 * Checklista „co musisz mieć do dnia składania".
 *
 * BEZSTANOWA z rozmysłem: wymagania postępowania (Radar SWZ) i stan sejfu
 * dokumentów mieszkają w OSOBNEJ usłudze, a ten endpoint nie ma prawa ich
 * kształtu zgadywać ani po cichu pobierać. Klient podaje je w żądaniu, my
 * dokładamy jedyną rzecz, której tamta usługa nie zna: DZIEŃ SKŁADANIA
 * z kalendarza postępowania — i to on decyduje, czy dokument „ważny dzisiaj"
 * będzie ważny wtedy, kiedy trzeba.
 *
 * Dzięki tej granicy checklista działa też wtedy, gdy Radar SWZ albo Sejf są
 * chwilowo nieosiągalne: `stanWiedzy` mówi wprost, czego nie wiemy, zamiast
 * pokazywać zero braków.
 */
const wejscieChecklisty = z.object({
  wymagania: z.array(z.object({}).passthrough()).max(200).optional(),
  dokumenty: z.array(z.object({}).passthrough()).max(500).optional(),
});

router.post('/tender/:id/checklista', ah(async (req, res) => {
  const parsed = wejscieChecklisty.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Nieprawidłowe wejście checklisty');

  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');

  const teraz = Date.now();
  const checklista = zbudujChecklisteOferty({
    tender,
    wymagania: parsed.data.wymagania ?? [],
    dokumenty: parsed.data.dokumenty ?? [],
    teraz,
  });

  res.json({
    checklista,
    // Kalendarz trzech terminów obok checklisty: pytania do SWZ mają własny,
    // WCZEŚNIEJSZY termin niż składanie, a to on zwykle przepada niezauważony.
    kalendarz: zbudujKalendarz(tender, { teraz: new Date(teraz).toISOString() }),
  });
}));

export default router;
