import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { tenders } from '../db/repos.js';
import { badRequest } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { publicTender } from '../lib/serialize.js';
import { pobierzZakresDanych, pobierzZnacznikiZrodel } from '../services/zakresZrodel.js';
import { WOJEWODZTWA } from '../lib/wojewodztwa.js';
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
