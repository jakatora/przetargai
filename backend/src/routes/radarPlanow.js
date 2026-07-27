import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { dopasujPozycjePlanu } from '../services/radarPlanow.js';
import { generujPlanPrzygotowan } from '../services/przygotowaniaPlanu.js';
import { wykryjZmiany, dopasujOgloszenie } from '../services/zmianyPlanu.js';

/*
 * RADAR PLANÓW POSTĘPOWAŃ — endpointy (ulepszenie „Radar planów postępowań: wiedz
 * o przetargu miesiące przed ogłoszeniem", podzadanie 4/6). Samodzielny router spójny
 * ze wzorcem Sejfu/Czarnej skrzynki/Symulatora płynności (routes/symulatorPlynnosci.js):
 * `Router`, walidacja `zod`, `ah` + `badRequest`, trasy UWIERZYTELNIONE.
 *
 *   • POST /dopasuj            — pozycje rocznego planu (art. 23 Pzp) + profil → ranking
 *                                dopasowań (krok 1/6, services/radarPlanow.js),
 *   • POST /przygotowania      — wykryta pozycja + profil → zamrożony plan przygotowań
 *                                (krok 2/6, services/przygotowaniaPlanu.js),
 *   • POST /zmiany             — dwie migawki pozycji (przed/po) → lista zmian planu
 *                                (krok 3/6, services/zmianyPlanu.js#wykryjZmiany),
 *   • POST /dopasuj-ogloszenie — pozycja planu + świeże ogłoszenie → pewność + alarm
 *                                „to jest to, na co czekałeś" (krok 3/6#dopasujOgloszenie),
 *   • POST /radar              — SKRÓT: ranking + plany przygotowań dla topowych pozycji
 *                                w jednym kroku (złożenie /dopasuj → /przygotowania).
 *
 * Świadoma różnica względem Sejfu/Czarnej skrzynki: router jest BEZSTANOWY — spina trzy
 * CZYSTE usługi z kroków 1–3/6 (bez UI, bez I/O, bez sieci, bez DB, bez płatnego AI).
 * Radar nic tu nie utrwala — to kalkulator „co się szykuje na osi czasu i jak się do tego
 * przygotować" — więc świadomie NIE importuje singletona `db`. Uwierzytelnienie zostaje:
 * to funkcja subskrypcyjna, nie chcemy anonimowego ruchu na trasach liczących.
 *
 * WALIDACJA egzekwuje tylko KSZTAŁT wejścia (typy, obecność) — semantykę, wartości brzegowe
 * i parsowanie (daty PL, kwoty, CPV BZP) usługi obsługują same, deterministycznie i
 * defensywnie. Dlatego pozycje/ogłoszenia przyjmujemy jako obiekty (`passthrough`), a
 * `dzisiaj` jest WSTRZYKIWANE parametrem (profil.dzisiaj / pole `dzisiaj`) — usługi nie
 * czytają zegara, więc ten sam wsad daje zawsze ten sam wynik.
 */

const router = Router();

// ── Walidacja wejścia ────────────────────────────────────────────────────────

// Pozycja planu / ogłoszenie — dowolny obiekt (usługa czyta z tolerowanych aliasów pól).
const obiektSchema = z.object({}).passthrough();

// Profil wykonawcy — typujemy znane pola luźno, resztę przepuszczamy (`passthrough`),
// bo usługi domyślają braki i tolerują dodatkowe pola (spójnie z symulatorem płynności).
const profilSchema = z
  .object({
    cpv: z.array(z.string()).optional(),
    slowaKluczowe: z.array(z.string()).optional(),
    region: z.string().optional(),
    dzisiaj: z.string().optional(),
    maksymalnaWartoscKontraktu: z.number().optional(),
    posiadaneDokumenty: z.array(z.string()).optional(),
  })
  .passthrough();

const dopasujSchema = z.object({
  pozycjePlanow: z.array(obiektSchema),
  profil: profilSchema,
});

const przygotowaniaSchema = z.object({
  pozycja: obiektSchema,
  profil: profilSchema.optional(),
  dzisiaj: z.string().optional(),
});

const zmianySchema = z.object({
  pozycjaPrzed: obiektSchema,
  pozycjaPo: obiektSchema,
});

const dopasujOgloszenieSchema = z.object({
  pozycja: obiektSchema,
  ogloszenie: obiektSchema,
});

const radarSchema = z.object({
  pozycjePlanow: z.array(obiektSchema),
  profil: profilSchema,
  dzisiaj: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

/** Domyślna liczba topowych pozycji, dla których /radar generuje plan przygotowań. */
const DOMYSLNY_LIMIT_PRZYGOTOWAN = 3;

// ── Endpointy ─────────────────────────────────────────────────────────────────

// Krok 1/6: pozycje rocznego planu × profil → ranking (rosnąco wg terminu wszczęcia,
// pozycje poniżej progu odcięte).
router.post('/dopasuj', authRequired, ah(async (req, res) => {
  const parsed = dopasujSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "pozycjePlanow" (tablica pozycji planu) i "profil" (obiekt: cpv, slowaKluczowe, region, dzisiaj).');
  }
  const ranking = dopasujPozycjePlanu(parsed.data);
  res.json({ ranking });
}));

// Krok 2/6: wykryta pozycja + profil → zamrożony plan przygotowań (dokumenty, konsorcjum,
// kamienie milowe cofnięte od terminu wszczęcia, komunikat startu).
router.post('/przygotowania', authRequired, ah(async (req, res) => {
  const parsed = przygotowaniaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "pozycja" (wykryta pozycja planu) oraz opcjonalnie "profil" i "dzisiaj".');
  }
  const plan = generujPlanPrzygotowan(parsed.data);
  res.json({ plan });
}));

// Krok 3/6: dwie migawki tej samej pozycji planu → lista zmian (termin/wartość/CPV/przedmiot).
router.post('/zmiany', authRequired, ah(async (req, res) => {
  const parsed = zmianySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "pozycjaPrzed" i "pozycjaPo" (dwie migawki tej samej pozycji planu).');
  }
  const zmiany = wykryjZmiany(parsed.data);
  res.json({ zmiany });
}));

// Krok 3/6: pozycja planu + świeże ogłoszenie → pewność dopasowania + alarm „to jest to".
router.post('/dopasuj-ogloszenie', authRequired, ah(async (req, res) => {
  const parsed = dopasujOgloszenieSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "pozycja" (pozycja planu) i "ogloszenie" (świeże ogłoszenie z BZP).');
  }
  const dopasowanie = dopasujOgloszenie(parsed.data);
  res.json({ dopasowanie });
}));

// Skrót: cała ścieżka radaru w jednym żądaniu — ranking pozycji + plany przygotowań dla
// topowych (najpilniejszych) dopasowań. Wynik = ręczne złożenie /dopasuj → /przygotowania:
// `ranking` jest identyczny jak z /dopasuj, a `przygotowania[i].plan` jak z /przygotowania.
router.post('/radar', authRequired, ah(async (req, res) => {
  const parsed = radarSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "pozycjePlanow" (tablica) i "profil" (obiekt) oraz opcjonalnie "dzisiaj" i "limit".');
  }
  const { pozycjePlanow, profil, dzisiaj, limit } = parsed.data;

  const ranking = dopasujPozycjePlanu({ pozycjePlanow, profil });
  const ile = limit ?? DOMYSLNY_LIMIT_PRZYGOTOWAN;
  const przygotowania = ranking.slice(0, ile).map((wpis) => Object.freeze({
    pozycja: wpis.pozycja,
    plan: generujPlanPrzygotowan({ pozycja: wpis.pozycja, profil, dzisiaj }),
  }));

  res.json({ ranking, przygotowania });
}));

export default router;
