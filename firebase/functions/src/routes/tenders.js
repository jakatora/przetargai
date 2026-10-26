import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { tenders } from '../db/repos.js';
import { badRequest } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { publicTender } from '../lib/serialize.js';
import { pobierzZakresDanych, pobierzZnacznikiZrodel } from '../services/zakresZrodel.js';
import { WOJEWODZTWA } from '../lib/wojewodztwa.js';
import { notFound } from '../lib/errors.js';
import { pobierzSzczegol as pobierzSzczegolPzDomyslnie, ZRODLO as ZRODLO_PZ } from '../services/platformaZakupowa.js';
import { pobierzDokumenty as pobierzDokumentyEzDomyslnie, czyIdPostepowania } from '../services/eZamowieniaDokumenty.js';
import {
  ZRODLA, SORTOWANIA, STATUSY_TERMINU, LIMIT_MAKS,
  normalizujFiltry, odciskFiltrow, kodujKursor, dekodujKursor, opisFiltrow,
} from '../lib/katalogPrzetargow.js';

/*
 * Katalog „Wszystkie przetargi" (P1-1).
 *
 * To jest DRUGA lista w aplikacji, obok feedu dopasowań — i jedyna, która
 * pokazuje rynek taki, jaki jest. Feed z definicji jest przycięty: profilem,
 * progiem dopasowania i dziennym limitem planu Free. Nowy użytkownik z pustym
 * profilem widział przez to pustkę i nie miał jak sprawdzić, czy aplikacja
 * w ogóle ma dane. Katalog odpowiada na to pytanie wprost.
 *
 * Reguła, której nie wolno tu złamać: ani jedno zapytanie w tym routerze nie
 * czyta profilu użytkownika, dopasowań ani puli. Autoryzacja jest tylko po to,
 * żeby katalog nie był otwartym proxy na dane.
 */

const router = Router();
router.use(authRequired);

/** Etykiety sortowań i statusów terminu — jedno miejsce prawdy dla obu języków. */
const ETYKIETY_SORTOWAN = {
  najnowsze: { pl: 'Najnowsze', en: 'Newest' },
  termin: { pl: 'Termin najbliżej', en: 'Deadline soonest' },
};

const ETYKIETY_TERMINU = {
  aktywne: { pl: 'Aktywne', en: 'Open' },
  poterminie: { pl: 'Po terminie', en: 'Closed' },
  wszystkie: { pl: 'Wszystkie terminy', en: 'Any deadline' },
};

/**
 * Słowniki filtrów. Aplikacja NIE wymyśla własnych etykiet ani kodów — inaczej
 * nowe źródło albo nowe sortowanie wymagałoby wydania nowej wersji aplikacji.
 */
router.get('/filtry', ah(async (_req, res) => {
  res.json({
    zrodla: ZRODLA.map(({ kod, etykieta, nazwa, rejestr, zakres }) => ({ kod, etykieta, nazwa, rejestr, zakres })),
    regiony: Object.entries(WOJEWODZTWA).map(([kod, nazwa]) => ({ kod, nazwa })),
    sortowania: Object.keys(SORTOWANIA).map((kod) => ({ kod, etykieta: ETYKIETY_SORTOWAN[kod] })),
    terminy: STATUSY_TERMINU.map((kod) => ({ kod, etykieta: ETYKIETY_TERMINU[kod] })),
    limit_maks: LIMIT_MAKS,
  });
}));

/**
 * Zakres danych (P1-4): co monitorujemy, kiedy to ostatnio zadziałało i czego
 * NIE obejmujemy. Osobna trasa, bo ekran „Zakres danych" w Koncie czyta ją
 * bezpośrednio, a lista przetargów dostaje z niej tylko skrót.
 */
router.get('/zakres-danych', ah(async (_req, res) => {
  res.json(await pobierzZakresDanych());
}));

/**
 * Lista przetargów z całego rynku — paginowana KURSOREM.
 *
 * `next_kursor` jest nieprzezroczysty i związany z zestawem filtrów: podanie go
 * przy innych filtrach kończy się błędem 400, a nie cichym wymieszaniem stron.
 * `wyczerpano: false` przy krótszej stronie znaczy „skończył się budżet odczytów
 * na to żądanie", a nie „koniec listy" — klient ma po prostu dociągnąć dalej.
 */
router.get('/', ah(async (req, res) => {
  const filtry = normalizujFiltry(req.query);
  const odcisk = odciskFiltrow(filtry);

  let kursor = null;
  if (req.query.kursor) {
    kursor = dekodujKursor(String(req.query.kursor));
    if (!kursor) throw badRequest('Nieprawidłowy kursor strony — zacznij listę od początku.');
    if (kursor.odcisk !== odcisk) {
      throw badRequest('Kursor pochodzi z innego zestawu filtrów — zacznij listę od początku.');
    }
  }

  const teraz = nowIso();
  const [wynik, znaczniki] = await Promise.all([
    tenders.katalog({ filtry, teraz, kursor }),
    pobierzZnacznikiZrodel(),
  ]);

  res.json({
    tenders: wynik.wiersze.map((t) => publicTender(t, znaczniki)),
    count: wynik.wiersze.length,
    limit: filtry.limit,
    next_kursor: wynik.ostatni ? kodujKursor({ ...wynik.ostatni, odcisk }) : null,
    // `wyczerpano: false` + `next_kursor` = jest więcej, tylko nie w tym żądaniu.
    wyczerpano: wynik.wyczerpano,
    przeskanowano: wynik.przeskanowano,
    filtry: opisFiltrow(filtry),
    zrodla: znaczniki,
  });
}));

export default router;

/*
 * Szczegół postępowania z platformazakupowa.pl NA ŻĄDANIE (2026-10-25). Lista platformy daje
 * tytuł/zamawiającego/termin; tryb, rodzaj, wymagania i ZAŁĄCZNIKI dociągamy dopiero, gdy ktoś
 * otworzy ogłoszenie — i zapisujemy przy ogłoszeniu na dobę, żeby kolejni oglądający (i kolejne
 * dotknięcia) nie szły do platformy. Żądań jest tyle, ilu zainteresowanych — nie crawl.
 */
export const CACHE_SZCZEGOLU_PZ_MS = 24 * 60 * 60 * 1000;
let pobierzSzczegolPz = pobierzSzczegolPzDomyslnie;
let pobierzDokumentyEz = pobierzDokumentyEzDomyslnie;
/** Test: podmiana pobierania dokumentów z e-Zamówień (null = domyślne). */
export function _ustawPobieranieDokumentowEz(fn) { pobierzDokumentyEz = fn ?? pobierzDokumentyEzDomyslnie; }
/** Tylko dla testów: podmiana pobierania (bez sieci). */
export function _ustawPobieranieSzczegoluPz(fn) { pobierzSzczegolPz = fn ?? pobierzSzczegolPzDomyslnie; }

router.post('/:id/szczegol-platformy', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Ogłoszenie nie zostało znalezione');
  if (tender.source !== ZRODLO_PZ) throw badRequest('To ogłoszenie nie pochodzi z platformazakupowa.pl');
  const teraz = nowIso();
  const swiezy = tender.pz_szczegol && tender.pz_szczegol_o && (Date.parse(teraz) - Date.parse(tender.pz_szczegol_o)) < CACHE_SZCZEGOLU_PZ_MS;
  if (swiezy) {
    res.json({ szczegol: tender.pz_szczegol, pobrano_o: tender.pz_szczegol_o, cached: true });
    return;
  }
  const idPlatformy = String(tender.bzp_external_id ?? tender.id).replace(/^pz:/, '');
  const szczegol = await pobierzSzczegolPz(idPlatformy);
  await tenders.zapiszSzczegolPz(tender.id, szczegol, teraz);
  res.json({ szczegol, pobrano_o: teraz, cached: false });
}));

/**
 * Dokumenty postępowania z e-Zamówień NA ŻĄDANIE (2026-10-26): ogłoszenie BZP zna `postepowanie_id`,
 * portal oddaje publicznie listę plików (SWZ, załączniki) z linkami do pobrania. Cache 24 h przy
 * ogłoszeniu (`ez_dokumenty`), jak szczegół platformazakupowa. Postępowanie prowadzone poza platformą
 * → pusta lista (to też odpowiedź, nie błąd).
 */
router.post('/:id/dokumenty-ezamowienia', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Ogłoszenie nie zostało znalezione');
  if (tender.source !== 'bzp') throw badRequest('To ogłoszenie nie pochodzi z BZP / e-Zamówień');
  if (!czyIdPostepowania(tender.postepowanie_id)) throw badRequest('Ogłoszenie nie ma identyfikatora postępowania na e-Zamówieniach');
  const teraz = nowIso();
  const swiezy = Array.isArray(tender.ez_dokumenty) && tender.ez_dokumenty_o && (Date.parse(teraz) - Date.parse(tender.ez_dokumenty_o)) < CACHE_SZCZEGOLU_PZ_MS;
  if (swiezy) {
    res.json({ dokumenty: tender.ez_dokumenty, pobrano_o: tender.ez_dokumenty_o, cached: true });
    return;
  }
  const dokumenty = await pobierzDokumentyEz(tender.postepowanie_id);
  await tenders.zapiszDokumentyEz(tender.id, dokumenty, teraz);
  res.json({ dokumenty, pobrano_o: teraz, cached: false });
}));
