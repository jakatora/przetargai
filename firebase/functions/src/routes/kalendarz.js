import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { saved, tenders } from '../db/repos.js';
import { notFound } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { zbudujKalendarz, nastepnyKrok, doIcs, STREFA } from '../lib/kalendarzPrzetargu.js';

/*
 * KALENDARZ TERMINÓW (etap 5, P1-7).
 *
 * Buduje się z ZAPISANYCH przetargów, bo to jedyna lista, którą użytkownik sam
 * wybrał — i jedyna, dla której pilnowanie trzech dat ma sens. Cała arytmetyka
 * (reguły ustawowe, strefa, ICS) siedzi w lib/kalendarzPrzetargu.js; tutaj zostaje
 * złożenie danych i kontrakt HTTP.
 *
 * Bez płatnego AI — terminy są wyliczane z przepisów, nie zgadywane przez model.
 */

const router = Router();
router.use(authRequired);

const PUSTKA = {
  pl: 'Nie masz jeszcze zapisanych przetargów. Zapisz przetarg gwiazdką — pokażemy tu termin pytań do SWZ, termin składania ofert i koniec związania ofertą.',
  en: 'You have no saved tenders yet. Save one with the star — we will show the deadline for questions, for bid submission and the end of bid validity here.',
};

/**
 * Zapisany wpis → kształt przyjmowany przez `zbudujKalendarz`.
 *
 * Pola przetargu są ZDENORMALIZOWANE na wpisie „Zapisanych" (render bez JOIN-a),
 * więc lista kosztuje jedno zapytanie. Wyjątkiem jest `anulowany`: nie ma go na
 * kopii, a to informacja, której przemilczenie kosztuje najwięcej — kalendarz
 * kazałby przygotowywać ofertę na postępowanie, którego już nie ma.
 */
function zeZapisanego(wpis, anulowany) {
  return {
    id: wpis.tender_id ?? wpis.id,
    title: wpis.tender_title ?? null,
    source: wpis.tender_source ?? 'bzp',
    deadline: wpis.tender_deadline ?? null,
    anulowany,
  };
}

/** Kalendarze wszystkich zapisanych przetargów użytkownika. */
async function kalendarzeUzytkownika(userId, teraz) {
  const zapisane = await saved.list(userId);
  if (!zapisane.length) return [];

  /*
   * Znacznik anulowania dociągamy z dokumentów przetargów. To do `saved.list`
   * dodatkowe odczyty — ale ograniczone limitem listy zapisanych (100), a bez nich
   * ekran „co i kiedy mnie czeka" pokazywałby terminy postępowań unieważnionych.
   */
  const dokumenty = await Promise.all(
    zapisane.map((w) => tenders.findById(w.tender_id ?? w.id).catch(() => null)),
  );

  return zapisane.map((wpis, i) => zbudujKalendarz(
    zeZapisanego(wpis, dokumenty[i]?.anulowany === true),
    { teraz },
  ));
}

/**
 * Pełny kalendarz + karta „następny krok".
 *
 * `nastepny` jest liczony PRZEZ WSZYSTKIE zapisane przetargi, nie w obrębie
 * jednego: wykonawca prowadzi kilka postępowań naraz i pyta „co robię najbliżej",
 * a nie „co robię w tym jednym".
 */
router.get('/', ah(async (req, res) => {
  const teraz = nowIso();
  const kalendarze = await kalendarzeUzytkownika(req.user.id, teraz);

  const wszystkiePozycje = kalendarze
    .filter((k) => !k.anulowany)
    .flatMap((k) => k.pozycje.map((p) => ({ ...p, tenderId: k.tenderId, tytul: k.tytul })));

  res.json({
    przetargi: kalendarze,
    nastepny: nastepnyKrok(wszystkiePozycje, teraz),
    strefa: STREFA,
    pustka: kalendarze.length ? null : PUSTKA,
  });
}));

/**
 * Eksport ICS.
 *
 * Plik, NIE adres subskrypcji. Kalendarz Google/Apple odpytujący URL cyklicznie nie
 * potrafi wysłać nagłówka `Authorization`, więc subskrypcja wymagałaby wpuszczenia
 * długożyciowego tokenu do samego adresu — a adresy kalendarzy lądują w historii
 * przeglądarki, w logach serwera i w udostępnianych linkach. Aplikacja pobiera plik
 * na żądanie i oddaje go systemowemu udostępnianiu; kalendarz importuje go raz,
 * a powtórny import AKTUALIZUJE zdarzenia (stabilny UID), zamiast je dublować.
 */
router.get('/ics', ah(async (req, res) => {
  const teraz = nowIso();
  const kalendarze = await kalendarzeUzytkownika(req.user.id, teraz);
  const ics = doIcs(kalendarze, { teraz });

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="przetargai-terminy.ics"');
  res.send(ics);
}));

/** Kalendarz JEDNEGO przetargu — do sekcji na ekranie szczegółów. */
router.get('/:tenderId', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.tenderId);
  if (!tender) throw notFound('Nie ma takiego ogłoszenia.');

  res.json({
    kalendarz: zbudujKalendarz(tender, { teraz: nowIso() }),
    strefa: STREFA,
  });
}));

export default router;
