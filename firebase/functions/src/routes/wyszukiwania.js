import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { wyszukiwania, tenders } from '../db/repos.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { publicTender } from '../lib/serialize.js';
import { pobierzZnacznikiZrodel } from '../services/zakresZrodel.js';
import {
  CZESTOTLIWOSCI, MAKS_WYSZUKIWAN, MAKS_ALERTOW, MAKS_DLUGOSC_NAZWY,
  normalizujWyszukiwanie, odciskWyszukiwania, proponowanaNazwa, nastepneSprawdzenie, sprawdzLimity,
} from '../lib/zapisaneWyszukiwania.js';
import { LIMIT_MAKS } from '../lib/katalogPrzetargow.js';

/*
 * ZAPISANE WYSZUKIWANIA (etap 5) — CRUD skopowany do właściciela.
 *
 * Reguła, której nie wolno tu złamać (ta sama co w katalogu): ani jedno zapytanie
 * w tym routerze nie czyta profilu użytkownika, dopasowań ani puli, i ani jedno
 * nie wywołuje płatnego AI. Obserwacja rynku ma być tania i przewidywalna —
 * inaczej nie da się jej uruchamiać co dwie godziny dla wszystkich kont.
 *
 * Cudzy zasób zwraca 404, a nie 403. 403 potwierdzałoby, że wpis o takim
 * identyfikatorze istnieje — a lista kryteriów, po jakich firma szuka kontraktów,
 * jest informacją handlową.
 */

const router = Router();
router.use(authRequired);

/** Kształt wpisu oddawany aplikacji — razem z wyliczonym terminem następnego sprawdzenia. */
function publiczne(w) {
  return {
    id: w.id,
    nazwa: w.nazwa,
    filtry: w.filtry,
    odcisk: w.odcisk,
    alert_wlaczony: w.alert_wlaczony,
    czestotliwosc: w.czestotliwosc,
    ostatnio_sprawdzone_o: w.ostatnio_sprawdzone_o ?? null,
    ostatnio_trafien: w.ostatnio_trafien ?? null,
    nastepne_sprawdzenie: w.alert_wlaczony ? nastepneSprawdzenie(w) : null,
    utworzone_o: w.utworzone_o,
  };
}

/**
 * Słowniki: częstotliwości i limity. Aplikacja NIE wymyśla własnych — inaczej nowa
 * częstotliwość albo zmiana limitu wymagałaby wydania nowej wersji aplikacji.
 */
router.get('/czestotliwosci', ah(async (_req, res) => {
  res.json({
    czestotliwosci: CZESTOTLIWOSCI.map(({ kod, etykieta, opis }) => ({ kod, etykieta, opis })),
    limity: {
      wyszukiwan: MAKS_WYSZUKIWAN,
      alertow: MAKS_ALERTOW,
      dlugosc_nazwy: MAKS_DLUGOSC_NAZWY,
    },
  });
}));

router.get('/', ah(async (req, res) => {
  const lista = await wyszukiwania.list(req.user.id);
  res.json({
    wyszukiwania: lista.map(publiczne),
    limity: { wyszukiwan: MAKS_WYSZUKIWAN, alertow: MAKS_ALERTOW },
  });
}));

router.post('/', ah(async (req, res) => {
  const wpis = normalizujWyszukiwanie(req.body ?? {});

  if (!wpis.nazwa) {
    /*
     * Nazwa jest wymagana, ale odmowa bez propozycji zostawiałaby użytkownika
     * z pustym polem i komunikatem „wpisz nazwę". Podajemy gotowy tekst zbudowany
     * z jego własnych filtrów — wystarczy go zatwierdzić.
     */
    throw badRequest('Zapisane wyszukiwanie musi mieć nazwę.', {
      kod: 'brak_nazwy',
      propozycja: proponowanaNazwa(wpis.filtry),
    });
  }

  const odcisk = odciskWyszukiwania(wpis.filtry);
  const istniejace = await wyszukiwania.list(req.user.id);
  const bramka = sprawdzBramke({ istniejace, odcisk, alertWlaczony: wpis.alert_wlaczony });
  if (bramka) throw bramka;

  const zapisane = await wyszukiwania.create(req.user.id, { ...wpis, odcisk });
  res.status(201).json({ wyszukiwanie: publiczne(zapisane) });
}));

router.get('/:id', ah(async (req, res) => {
  const w = await wyszukiwania.get(req.user.id, req.params.id);
  if (!w) throw notFound('Nie ma takiego zapisanego wyszukiwania.');
  res.json({ wyszukiwanie: publiczne(w) });
}));

router.patch('/:id', ah(async (req, res) => {
  const biezace = await wyszukiwania.get(req.user.id, req.params.id);
  if (!biezace) throw notFound('Nie ma takiego zapisanego wyszukiwania.');

  const body = req.body ?? {};
  /*
   * Aktualizacja CZĄSTKOWA: pole nieobecne w żądaniu zachowuje dotychczasową
   * wartość. Przepuszczenie tu `normalizujWyszukiwanie` na samym ciele zresetowałoby
   * filtry do domyślnych przy zmianie samej nazwy — czyli po cichu poszerzyło
   * obserwację na cały rynek.
   */
  const scalone = normalizujWyszukiwanie({
    nazwa: Object.hasOwn(body, 'nazwa') ? body.nazwa : biezace.nazwa,
    filtry: Object.hasOwn(body, 'filtry') ? body.filtry : biezace.filtry,
    alert_wlaczony: Object.hasOwn(body, 'alert_wlaczony') ? body.alert_wlaczony : biezace.alert_wlaczony,
    czestotliwosc: Object.hasOwn(body, 'czestotliwosc') ? body.czestotliwosc : biezace.czestotliwosc,
  });

  if (!scalone.nazwa) {
    throw badRequest('Zapisane wyszukiwanie musi mieć nazwę.', {
      kod: 'brak_nazwy',
      propozycja: proponowanaNazwa(scalone.filtry),
    });
  }

  const odcisk = odciskWyszukiwania(scalone.filtry);
  const istniejace = await wyszukiwania.list(req.user.id);
  const bramka = sprawdzBramke({
    istniejace, odcisk, alertWlaczony: scalone.alert_wlaczony, pomijanyId: biezace.id,
  });
  if (bramka) throw bramka;

  const po = await wyszukiwania.update(req.user.id, req.params.id, {
    nazwa: scalone.nazwa,
    filtry: scalone.filtry,
    alert_wlaczony: scalone.alert_wlaczony,
    czestotliwosc: scalone.czestotliwosc,
    odcisk,
  });
  res.json({ wyszukiwanie: publiczne(po) });
}));

router.delete('/:id', ah(async (req, res) => {
  const usuniete = await wyszukiwania.remove(req.user.id, req.params.id);
  if (!usuniete) throw notFound('Nie ma takiego zapisanego wyszukiwania.');
  res.json({ usuniete: true });
}));

/**
 * Podgląd: co TERAZ pasuje do zapisanych filtrów.
 *
 * Czysty odczyt katalogu — NIE dotyka checkpointu wyszukiwania. Gdyby dotykał,
 * otwarcie ekranu „zobacz, co znajdzie" konsumowałoby okno monitoringu i kolejny
 * przebieg zgłaszałby zero trafień, bo „już to widzieliśmy".
 */
router.get('/:id/podglad', ah(async (req, res) => {
  const w = await wyszukiwania.get(req.user.id, req.params.id);
  if (!w) throw notFound('Nie ma takiego zapisanego wyszukiwania.');

  const limitSurowy = Number(req.query.limit);
  const limit = Number.isFinite(limitSurowy)
    ? Math.min(Math.max(Math.trunc(limitSurowy), 1), LIMIT_MAKS)
    : 20;

  const [wynik, znaczniki] = await Promise.all([
    tenders.katalog({ filtry: { ...w.filtry, limit }, teraz: nowIso(), kursor: null }),
    pobierzZnacznikiZrodel(),
  ]);

  res.json({
    tenders: wynik.wiersze.map((t) => publicTender(t, znaczniki)),
    count: wynik.wiersze.length,
    wyczerpano: wynik.wyczerpano,
    filtry: w.filtry,
  });
}));

/**
 * Limity i duplikat → gotowy błąd HTTP albo `null`, gdy zapis może przejść.
 * Jedna funkcja dla POST i PATCH: rozjazd bramki między zapisem a edycją byłby
 * niewidoczny, a pozwalałby obejść limit przez „zapisz bez alertu, potem włącz".
 */
function sprawdzBramke(argumenty) {
  const wynik = sprawdzLimity(argumenty);
  if (wynik.ok) return null;
  return conflict(wynik.komunikat.pl, {
    kod: wynik.kod,
    komunikat: wynik.komunikat,
    istniejaceId: wynik.istniejaceId ?? null,
  });
}

export default router;
