import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { alerty, historiaZmian, tenders } from '../db/repos.js';
import { notFound } from '../lib/errors.js';
import { TYPY_ZMIAN } from '../lib/zmianyOgloszenia.js';

/*
 * CENTRUM ALERTÓW I ZMIAN (etap 5).
 *
 * Push potrafi zniknąć: telefon go schowa, użytkownik zdejmie powiadomienie, zgody
 * nigdy nie było. Alert, który istnieje WYŁĄCZNIE jako push, jest więc alertem,
 * którego można nie zobaczyć — a to dokładnie ta klasa informacji („termin skrócony
 * o 6 dni"), której przegapienie kosztuje kontrakt. Centrum jest trwałym rejestrem
 * tego samego, co poszło pushem.
 *
 * Bez płatnego AI: wszystko tutaj to odczyt zapisanych wpisów.
 */

const router = Router();
router.use(authRequired);

const LIMIT_DOMYSLNY = 50;
const LIMIT_MAKS = 100;

function limitZapytania(surowy, domyslny = LIMIT_DOMYSLNY) {
  const n = Number(surowy);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), LIMIT_MAKS) : domyslny;
}

/** Lista alertów właściciela + licznik nieprzeczytanych na plakietkę. */
router.get('/', ah(async (req, res) => {
  const limit = limitZapytania(req.query.limit);
  const [lista, nieprzeczytane] = await Promise.all([
    alerty.lista(req.user.id, limit),
    alerty.nieprzeczytane(req.user.id),
  ]);

  res.json({
    alerty: lista,
    nieprzeczytane,
    // Słownik typów zmian z etykietami PL/EN — ekran nie wymyśla własnych nazw.
    typy: TYPY_ZMIAN.map(({ kod, etykieta, istotna }) => ({ kod, etykieta, istotna })),
  });
}));

router.post('/:id/przeczytany', ah(async (req, res) => {
  const ok = await alerty.oznaczPrzeczytany(req.user.id, req.params.id);
  if (!ok) throw notFound('Nie ma takiego alertu.');
  res.json({ przeczytany: true });
}));

router.post('/przeczytane', ah(async (req, res) => {
  const oznaczone = await alerty.oznaczWszystkiePrzeczytane(req.user.id);
  res.json({ oznaczone });
}));

/**
 * Historia zmian JEDNEGO ogłoszenia — pełna, także zmiany nieistotne.
 *
 * Alert dostaje tylko to, co istotne; ekran szczegółów przetargu pokazuje wszystko,
 * bo tam użytkownik przychodzi z pytaniem „co się w tym ogłoszeniu działo".
 * Trasa jest PUBLICZNA w granicach konta (każdy zalogowany widzi historię każdego
 * ogłoszenia) — tak samo jak sam katalog, bo to dane z rejestrów publicznych.
 */
router.get('/zmiany/:tenderId', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.tenderId);
  if (!tender) throw notFound('Nie ma takiego ogłoszenia.');

  const zmiany = await historiaZmian.lista(req.params.tenderId, limitZapytania(req.query.limit));
  res.json({
    tender_id: req.params.tenderId,
    tytul: tender.title ?? null,
    zmiany,
    // Pusta historia ma znaczyć „nic się nie zmieniło", a nie „nie wiemy" —
    // monitoring działa od momentu, w którym ogłoszenie trafiło do bazy.
    obserwowane_od: tender.fetched_at ?? null,
  });
}));

export default router;
