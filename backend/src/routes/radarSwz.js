import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import { postepowaniaSwz, pytaniaSwz } from '../db/repos.js';
import { analizujSwz } from '../services/analizaSwz.js';
import { odswiezPostepowanie } from '../jobs/monitorSwz.js';

/*
 * Radar SWZ — uruchomienie ANALIZY treści SWZ dla danego postępowania
 * (ulepszenie „Radar pytań i odpowiedzi do SWZ", podzadanie 3/7) oraz RĘCZNE
 * odświeżenie publikacji zamawiającego (podzadanie 5/7).
 *
 * POST /postepowania/:id/analiza — dla postępowania należącego do zalogowanego
 * użytkownika bierze treść SWZ + wzoru umowy + przedmiaru, przepuszcza przez
 * analizator (wywołanie Claude, services/analizaSwz.js) i zapisuje wykryte
 * pytania jako SZKICE w `pytania_swz`. Zwraca zapisane szkice.
 *
 * POST /postepowania/:id/odswiez — ręczny odpowiednik cyklicznego monitora
 * publikacji (jobs/monitorSwz.js): wchłania nowo opublikowaną wersję SWZ podaną
 * w body (i/lub to, co widzi automatyczne źródło), zapisuje ją jako kolejną
 * wersję i przy realnej zmianie treści tworzy wpis `zmiany_swz` (diff + opis skutku).
 *
 * Postępowanie musi już istnieć i należeć do użytkownika (model danych +
 * repozytoria z podzadania 1/7); odczyt skopowany po `user_id` — cudze/nieistniejące
 * => 404, bez wycieku danych. Analiza/opis zmiany to płatne AI, więc trasy są
 * uwierzytelnione, a bramka budżetu siedzi w serwisie.
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

// Ręczne odświeżenie: opcjonalnie niesie nowo opublikowaną wersję SWZ (treść inline
// albo ścieżka/URL + hasz). Wszystkie pola opcjonalne — bez treści żądanie i tak
// odpyta automatyczne źródło (domyślnie stub => nic nowego).
const odswiezSchema = z.object({
  tresc: z.string().optional(),
  sciezka: z.string().optional(),
  hash: z.string().optional(),
  dataPublikacji: z.string().optional(),
});

router.post('/postepowania/:id/odswiez', authRequired, ah(async (req, res) => {
  const postepowanie = postepowaniaSwz.findByIdForUser(req.params.id, req.user.id);
  if (!postepowanie) throw notFound('Nie znaleziono postępowania SWZ o podanym id.');

  const parsed = odswiezSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Nieprawidłowe dane odświeżenia SWZ.');
  const d = parsed.data;

  // Wersję wgraną ręcznie dokładamy tylko, gdy niesie treść lub ścieżkę — inaczej
  // nie ma czego wersjonować (monitor sam odpyta źródło).
  const pchnietaWersja = (d.tresc?.trim() || d.sciezka?.trim())
    ? { tresc: d.tresc ?? null, sciezka: d.sciezka ?? null, hash: d.hash ?? null, dataPublikacji: d.dataPublikacji ?? null }
    : null;

  const wynik = await odswiezPostepowanie({ postepowanie, pchnietaWersja });

  res.status(200).json({
    postepowanie_id: postepowanie.id,
    nowe_wersje: wynik.noweWersje,
    zmiany: wynik.zmiany,
    wersje: wynik.wersje,
    zmiany_wpisy: wynik.zmiany_wpisy,
  });
}));

export default router;
