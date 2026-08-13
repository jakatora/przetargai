import { Router } from 'express';

/**
 * MOST ATLAS-a — przekaźnik między telefonem właściciela a ATLAS-em w jego domu.
 *
 * Właściciel (2026-08-13): „czemu nie zrobisz tego tak, że nie będę musiał się łączyć, tylko
 * zawsze będzie połączone?". Telefon w LTE nie ma jak dosięgnąć komputera za NAT-em, a
 * przekierowanie portu na routerze oznaczałoby wystawienie na internet narzędzia, które pisze
 * kod i steruje komputerem. Dlatego to ATLAS łączy się TUTAJ, wychodząco, i sam odbiera żądania.
 *
 *   ATLAS  ──GET /pobierz (long poll ~25 s)──►  TEN PLIK  ◄── żądanie ──  TELEFON
 *   ATLAS  ──POST /odpowiedz─────────────────►  TEN PLIK  ─── odpowiedź ──►  TELEFON
 *
 * ZASADA, KTÓREJ NIE WOLNO ZŁAMAĆ: to jest GŁUPIA RURA.
 * Przekaźnik NIE zna tokenów telefonu, niczego nie autoryzuje i niczego nie zapisuje na dysku —
 * przekazuje nagłówek `Authorization` nietknięty, a decyzję podejmuje bramka pilota w ATLAS-ie.
 * Zaufanie zostaje na komputerze właściciela. Tutaj sprawdzamy JEDNO: czy po drugiej stronie
 * jest naprawdę jego ATLAS (sekret `ATLAS_MOST_SEKRET`).
 *
 * Wszystko żyje w PAMIĘCI procesu. Restart hostingu gubi żądania w locie — i dobrze: te dane
 * (polecenia, raporty) nie mają prawa leżeć na cudzym dysku.
 */

const router = Router();

const SEKRET = process.env.ATLAS_MOST_SEKRET || '';
const CZEKANIE_ATLAS_MS = 30_000; // ile trzymamy long poll ATLAS-a
const CZEKANIE_TELEFON_MS = 90_000; // ile telefon czeka na odpowiedź (agent bywa powolny)
const MAKS_KOLEJKA = 20; // bezpiecznik: nikt nie zaleje pamięci procesu

/** Żądania czekające na odebranie przez ATLAS-a. */
const kolejka = [];
/** id → { res, timer } — telefony, które czekają na odpowiedź. */
const czekajacy = new Map();
/** Long poll ATLAS-a, gdy kolejka jest pusta. */
let atlasCzeka = null;

let licznik = 0;
const nowyId = () => `z${Date.now().toString(36)}${(licznik++).toString(36)}`;

function sekretOk(req) {
  const naglowek = req.get('authorization') || '';
  const token = naglowek.toLowerCase().startsWith('bearer ') ? naglowek.slice(7).trim() : '';
  return Boolean(SEKRET) && token === SEKRET;
}

function wydajAtlasowi(res, zadanie) {
  res.status(200).json(zadanie);
}

/** ATLAS pyta: „są dla mnie żądania?". Odpowiadamy od razu albo trzymamy połączenie. */
router.get('/pobierz', (req, res) => {
  if (!sekretOk(req)) return res.status(401).json({ blad: 'zły sekret domu' });

  const zadanie = kolejka.shift();
  if (zadanie) return wydajAtlasowi(res, zadanie);

  // Nic nie czeka — trzymamy połączenie otwarte. Drugi ATLAS (np. po restarcie) zastępuje
  // poprzedniego: stary dostaje 204 i sam spróbuje ponownie.
  if (atlasCzeka) {
    clearTimeout(atlasCzeka.timer);
    atlasCzeka.res.status(204).end();
  }
  const timer = setTimeout(() => {
    atlasCzeka = null;
    res.status(204).end();
  }, CZEKANIE_ATLAS_MS);
  atlasCzeka = { res, timer };
  res.on('close', () => {
    if (atlasCzeka && atlasCzeka.res === res) {
      clearTimeout(timer);
      atlasCzeka = null;
    }
  });
});

/** ATLAS odsyła wynik — oddajemy go telefonowi, który na niego czeka. */
router.post('/odpowiedz', (req, res) => {
  if (!sekretOk(req)) return res.status(401).json({ blad: 'zły sekret domu' });

  const { id, status, body } = req.body || {};
  const czekajacy_ = czekajacy.get(id);
  if (!czekajacy_) return res.status(200).json({ ok: true, uwaga: 'nikt już nie czeka' });

  clearTimeout(czekajacy_.timer);
  czekajacy.delete(id);
  czekajacy_.res
    .status(Number(status) || 200)
    .type('application/json')
    .send(typeof body === 'string' ? body : JSON.stringify(body ?? {}));
  return res.status(200).json({ ok: true });
});

/** Telefon woła ATLAS-a. Ścieżka po `/p/` trafia 1:1 do lokalnego ATLAS-a. */
router.all(/^\/p\/(.*)$/, (req, res) => {
  if (!SEKRET) return res.status(503).json({ blad: 'most ATLAS-a nie jest skonfigurowany' });
  if (kolejka.length >= MAKS_KOLEJKA) {
    return res.status(503).json({ blad: 'most zapchany — spróbuj za chwilę' });
  }

  const id = nowyId();
  const zadanie = {
    id,
    sciezka: '/' + (req.params[0] || ''),
    metoda: req.method,
    // NIETKNIĘTY token telefonu — tu go nie sprawdzamy, to robi bramka w ATLAS-ie.
    autoryzacja: req.get('authorization') || '',
    body: req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '',
  };

  const timer = setTimeout(() => {
    czekajacy.delete(id);
    res.status(504).json({ blad: 'ATLAS nie odpowiedział — sprawdź, czy komputer działa' });
  }, CZEKANIE_TELEFON_MS);
  czekajacy.set(id, { res, timer });

  // Jeśli ATLAS wisi na long pollu, dostaje żądanie NATYCHMIAST — stąd „zawsze połączone".
  if (atlasCzeka) {
    clearTimeout(atlasCzeka.timer);
    const { res: atlasRes } = atlasCzeka;
    atlasCzeka = null;
    wydajAtlasowi(atlasRes, zadanie);
  } else {
    kolejka.push(zadanie);
  }
});

/** Czy dom jest podłączony — do diagnostyki z telefonu, bez ujawniania czegokolwiek. */
router.get('/stan', (_req, res) => {
  res.json({
    skonfigurowany: Boolean(SEKRET),
    dom_podlaczony: Boolean(atlasCzeka),
    w_kolejce: kolejka.length,
    czekajacych: czekajacy.size,
  });
});

export default router;
