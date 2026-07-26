import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { postepowaniaSwz, pytaniaSwz } from '../db/repos.js';
import { analizujSwz } from '../services/analizaSwz.js';

/*
 * Radar SWZ — uruchomienie ANALIZY treści SWZ dla danego postępowania
 * (ulepszenie „Radar pytań i odpowiedzi do SWZ", podzadanie 3/7).
 *
 * POST /postepowania/:id/analiza — dla postępowania należącego do zalogowanego
 * użytkownika bierze treść SWZ + wzoru umowy + przedmiaru, przepuszcza przez
 * analizator (wywołanie Claude, services/analizaSwz.js) i zapisuje wykryte
 * pytania jako SZKICE w `pytania_swz`. Zwraca zapisane szkice.
 *
 * Postępowanie musi już istnieć i należeć do użytkownika (model danych +
 * repozytoria z podzadania 1/7); odczyt skopowany po `user_id` — cudze/nieistniejące
 * => 404, bez wycieku danych. Analiza to płatne AI, więc trasa jest uwierzytelniona,
 * a bramka budżetu siedzi w serwisie.
 */

const router = Router();

// Wszystkie pola opcjonalne w schemacie; regułę „co najmniej jeden dokument niesie
// treść" egzekwujemy niżej (maTresc) dla czytelnego 400 — spójnie z /umowa/analiza.
const analizaSchema = z.object({
  swz: z.string().optional(),
  umowa: z.string().optional(),
  przedmiar: z.string().optional(),
});

/** Czy żądanie w ogóle niesie coś do analizy (SWZ, umowa lub przedmiar). */
function maTresc(d) {
  return Boolean(d.swz?.trim()) || Boolean(d.umowa?.trim()) || Boolean(d.przedmiar?.trim());
}

router.post('/postepowania/:id/analiza', authRequired, ah(async (req, res) => {
  const postepowanie = postepowaniaSwz.findByIdForUser(req.params.id, req.user.id);
  if (!postepowanie) throw notFound('Nie znaleziono postępowania SWZ o podanym id.');

  const parsed = analizaSchema.safeParse(req.body ?? {});
  if (!parsed.success || !maTresc(parsed.data)) {
    throw badRequest('Podaj treść do analizy: "swz", "umowa" lub "przedmiar" (co najmniej jedno).');
  }

  const pytania = await analizujSwz({
    swz: parsed.data.swz ?? '',
    umowa: parsed.data.umowa ?? '',
    przedmiar: parsed.data.przedmiar ?? '',
  });

  // Zapis wykrytych pytań jako szkice powiązane z postępowaniem (status 'szkic'
  // domyślny w repo). Fragment SWZ zachowujemy do UI („czego dotyczy pytanie").
  const zapisane = pytania.map((p) => pytaniaSwz.create({
    postepowanieId: postepowanie.id,
    tresc: p.tresc,
    fragmentSwz: p.fragment,
    status: 'szkic',
  }));

  res.status(201).json({ postepowanie_id: postepowanie.id, liczba: zapisane.length, pytania: zapisane });
}));

export default router;
