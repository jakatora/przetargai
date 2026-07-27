import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import { authRequired } from '../middleware/auth.js';
import {
  harmonogramZwrotu,
  statusZwrotu,
  naliczOdsetki,
  porownajKoszt,
  PROCENT_ZATRZYMANY_MAX,
} from '../lib/zabezpieczenieZwrot.js';
import { generujWezwanieDoZwrotu, wezwanieDoPliku } from '../lib/zabezpieczenieWezwanie.js';

/*
 * ODZYSKIWACZ ZABEZPIECZENIA — endpointy (ulepszenie „pilnuj zwrotu swoich pieniędzy
 * po kontrakcie"). Samodzielny router spójny ze wzorcem Radaru planów / Symulatora
 * płynności: `Router`, walidacja `zod`, `ah` + `badRequest`, trasy UWIERZYTELNIONE.
 *
 *   • POST /harmonogram — kwota zabezpieczenia + daty (należyte wykonanie, upływ
 *       rękojmi) → transze zwrotu wg art. 453 Pzp z terminami; gdy podano „dzisiaj",
 *       każda transza dostaje status wymagalności (oczekuje/wymagalne/przeterminowane)
 *       i — przy zwłoce — naliczone odsetki, a odpowiedź niesie flagę `alarm`
 *       (jest kwota, której można DZIŚ żądać),
 *   • POST /porownaj    — kwota + lata + stawki → realny koszt „zamrozić gotówkę"
 *       vs „zapłacić prowizję za gwarancję bankową" i wskazanie tańszej opcji,
 *   • POST /wezwanie    — kwota + termin [+ dzisiaj] → gotowe pismo wzywające do zwrotu
 *       (wariant przeterminowany dokłada art. 405 KC i odsetki); ?pobierz=1 EKSPORTUJE
 *       treść do pliku (.txt jako załącznik).
 *
 * Świadomie BEZSTANOWY — spina czyste liby (lib/zabezpieczenieZwrot.js,
 * lib/zabezpieczenieWezwanie.js): bez UI, bez I/O, bez sieci, bez DB, bez płatnego AI.
 * To kalkulator „kiedy i ile pieniędzy odzyskasz i jak się o nie upomnieć" — nic tu nie
 * utrwalamy, więc świadomie NIE importujemy singletona `db`. Uwierzytelnienie zostaje:
 * to funkcja subskrypcyjna, nie chcemy anonimowego ruchu na trasach liczących.
 *
 * WALIDACJA egzekwuje KSZTAŁT (typy, obecność) oraz proste wartości brzegowe pieniędzy
 * (kwota > 0, lata > 0, procent 0–30, data poprawna) — resztę reguły (parsowanie dat,
 * zaokrąglenia, niezmienniki sum) trzymają czyste liby, deterministycznie i defensywnie.
 */

const router = Router();

const harmonogramSchema = z.object({
  kwota: z.number(),
  dataNalezytegoWykonania: z.string(),
  dataUplywuRekojmi: z.string(),
  procentZatrzymany: z.number().optional(),
  dzisiaj: z.string().optional(),
  stopaRoczna: z.number().optional(),
});

const porownajSchema = z.object({
  kwota: z.number(),
  lata: z.number(),
  prowizjaGwarancjiRocznaProc: z.number().optional(),
  kosztKapitaluRocznyProc: z.number().optional(),
});

const wezwanieSchema = z.object({
  kwota: z.number(),
  termin: z.string(),
  dzisiaj: z.string().optional(),
  stopaRoczna: z.number().optional(),
  tytulTranszy: z.string().max(120).optional(),
  numerUmowy: z.string().max(120).optional(),
  przedmiot: z.string().max(300).optional(),
  wykonawca: z.string().max(300).optional(),
  zamawiajacy: z.string().max(300).optional(),
  miejscowosc: z.string().max(120).optional(),
  dataPisma: z.string().max(40).optional(),
  waluta: z.string().max(10).optional(),
});

/** Czy string wygląda na poprawną datę (YYYY-MM-DD / ISO); pusty/śmieci → false. */
function poprawnaData(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s.trim())) return false;
  return !Number.isNaN(new Date(s).getTime());
}

// Harmonogram zwrotu + (opcjonalnie) status wymagalności i odsetki względem „dzisiaj".
router.post('/harmonogram', authRequired, ah(async (req, res) => {
  const parsed = harmonogramSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw badRequest('Podaj "kwota" (liczba), "dataNalezytegoWykonania" i "dataUplywuRekojmi" (daty YYYY-MM-DD).');
  }
  const d = parsed.data;
  if (!(Number.isFinite(d.kwota) && d.kwota > 0)) {
    throw badRequest('"kwota" musi być liczbą dodatnią (wysokość zabezpieczenia).');
  }
  if (!poprawnaData(d.dataNalezytegoWykonania) || !poprawnaData(d.dataUplywuRekojmi)) {
    throw badRequest('"dataNalezytegoWykonania" i "dataUplywuRekojmi" muszą być poprawnymi datami (YYYY-MM-DD).');
  }
  if (d.procentZatrzymany !== undefined
    && !(Number.isFinite(d.procentZatrzymany) && d.procentZatrzymany >= 0 && d.procentZatrzymany <= PROCENT_ZATRZYMANY_MAX)) {
    throw badRequest(`"procentZatrzymany" musi być z zakresu [0, ${PROCENT_ZATRZYMANY_MAX}] (art. 453 ust. 2 Pzp).`);
  }

  const harmonogram = harmonogramZwrotu({
    kwota: d.kwota,
    dataNalezytegoWykonania: d.dataNalezytegoWykonania,
    dataUplywuRekojmi: d.dataUplywuRekojmi,
    procentZatrzymany: d.procentZatrzymany,
  });

  // Status/odsetki tylko gdy podano „dzisiaj" — bez zegara po stronie serwera.
  let alarm = false;
  if (d.dzisiaj !== undefined) {
    harmonogram.transze = harmonogram.transze.map((t) => {
      const { status, dni } = statusZwrotu({ termin: t.termin, dzisiaj: d.dzisiaj });
      const odsetki = status === 'przeterminowane'
        ? naliczOdsetki({ kwota: t.kwota, termin: t.termin, dzisiaj: d.dzisiaj, stopaRoczna: d.stopaRoczna }).odsetki
        : 0;
      if (status === 'wymagalne' || status === 'przeterminowane') alarm = true;
      return { ...t, status, dni, odsetki };
    });
  }

  res.json({ harmonogram, alarm });
}));

// Porównanie kosztu: zamrozić gotówkę vs prowizja za gwarancję bankową.
router.post('/porownaj', authRequired, ah(async (req, res) => {
  const parsed = porownajSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Podaj "kwota" i "lata" (liczby dodatnie).');
  const d = parsed.data;
  if (!(Number.isFinite(d.kwota) && d.kwota > 0)) throw badRequest('"kwota" musi być liczbą dodatnią.');
  if (!(Number.isFinite(d.lata) && d.lata > 0)) throw badRequest('"lata" musi być liczbą dodatnią (okres zamrożenia).');

  const porownanie = porownajKoszt({
    kwota: d.kwota,
    lata: d.lata,
    prowizjaGwarancjiRocznaProc: d.prowizjaGwarancjiRocznaProc,
    kosztKapitaluRocznyProc: d.kosztKapitaluRocznyProc,
  });
  res.json({ porownanie });
}));

// Gotowe wezwanie do zwrotu; ?pobierz=1 => treść pisma jako załącznik .txt.
router.post('/wezwanie', authRequired, ah(async (req, res) => {
  const parsed = wezwanieSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Podaj "kwota" (liczba dodatnia) i "termin" (data YYYY-MM-DD).');
  const d = parsed.data;
  if (!(Number.isFinite(d.kwota) && d.kwota > 0)) throw badRequest('"kwota" musi być liczbą dodatnią.');
  if (!poprawnaData(d.termin)) throw badRequest('"termin" musi być poprawną datą (YYYY-MM-DD) — dniem wymagalności zwrotu.');

  const wezwanie = generujWezwanieDoZwrotu(d);

  if (String(req.query.pobierz ?? '') === '1') {
    const plik = wezwanieDoPliku(wezwanie);
    res.setHeader('Content-Type', plik.typ);
    res.setHeader('Content-Disposition', `attachment; filename="${plik.nazwa}"`);
    return res.send(plik.zawartosc);
  }
  return res.json({ wezwanie });
}));

export default router;
