import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { saved, tenders, limitEksportu } from '../db/repos.js';
import { badRequest, tooMany, serviceUnavailable } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { normalizujFiltry, LIMIT_MAKS } from '../lib/katalogPrzetargow.js';
import {
  doCsv, wierszZapisanego, wierszKatalogu, KOLUMNY_ZAPISANYCH, KOLUMNY_KATALOGU,
  nazwaPliku, MAKS_WIERSZY_KATALOGU,
} from '../lib/eksportCsv.js';
import { sendEmail } from '../services/email.js';
import { doIcs } from '../lib/kalendarzPrzetargu.js';
import { kalendarzeUzytkownika } from './kalendarz.js';

/*
 * EKSPORT CSV (P2-3) — „Zapisane" i katalog rynku do Excela / CRM-u.
 *
 * Dwie drogi, bo telefon nie ma gdzie zapisać pliku bez nowych modułów natywnych:
 *  • GET *.csv — plik wprost (przeglądarka, integracje, przyszła wersja aplikacji),
 *  • POST /wyslij — ten sam plik jako ZAŁĄCZNIK na adres właściciela konta. Firma
 *    i tak otwiera go na komputerze, w Excelu.
 *
 * Bez AI; eksport katalogu czyta ten sam skan co GET /tenders, z sufitem wierszy.
 */

const router = Router();
router.use(authRequired);

/** Ile e-maili z eksportem dziennie na konto. */
export const LIMIT_WYSYLEK_DZIENNIE = 10;

async function eksportZapisanych(userId, teraz) {
  const wiersze = (await saved.list(userId, 500)).map(wierszZapisanego);
  return { nazwa: nazwaPliku('zapisane', teraz), csv: doCsv(wiersze, KOLUMNY_ZAPISANYCH), wierszy: wiersze.length, obciety: false };
}

/**
 * Sufit dokumentów PRZESKANOWANYCH przez jeden eksport katalogu (2026-09-25).
 *
 * Rzadki filtr (np. wąskie CPV w jednym województwie) potrafi wymagać przejścia
 * przez dużą część rynku, zanim zbierze wiersze. 50 tys. odczytów z projekcją
 * ≈ 0,03 USD i kilkadziesiąt sekund — mieści się w limicie funkcji `api` (300 s).
 * Po jego osiągnięciu plik mówi uczciwie `obciety: true`.
 */
export const MAKS_SKANU_EKSPORTU = 50_000;

/**
 * Katalog z filtrami jak GET /tenders — strona po stronie, do wyczerpania skanu
 * albo do sufitu wierszy / skanu.
 *
 * 🚨 Pusta strona NIE znaczy „koniec" (naprawa 2026-09-25). `katalog` kończy skan po
 * 1200 dokumentach; przy rzadkim filtrze zwraca wtedy zero wierszy z `wyczerpano:
 * false`. Dawniej pętla się tu kończyła, a plik miał `obciety: false` — deklarował
 * komplet, choć za sufitem skanu leżały pasujące ogłoszenia. Koniec wyznacza
 * wyłącznie `wyczerpano`.
 *
 * @param {{katalog?: Function}} [zaleznosci] wstrzykiwane w testach
 */
export async function eksportKatalogu(query, teraz, { katalog = (a) => tenders.katalog(a) } = {}) {
  const filtry = { ...normalizujFiltry(query ?? {}), limit: LIMIT_MAKS };
  const zebrane = [];
  let kursor = null;
  let przeskanowano = 0;
  let obciety = false;
  for (;;) {
    const wynik = await katalog({ filtry, teraz, kursor });
    zebrane.push(...wynik.wiersze);
    przeskanowano += wynik.przeskanowano ?? 0;
    if (wynik.wyczerpano || !wynik.ostatni) {
      obciety = zebrane.length > MAKS_WIERSZY_KATALOGU;
      break;
    }
    // Niewyczerpany skan na suficie wierszy albo odczytów — dalej MOGĄ być trafienia.
    if (zebrane.length >= MAKS_WIERSZY_KATALOGU || przeskanowano >= MAKS_SKANU_EKSPORTU) {
      obciety = true;
      break;
    }
    kursor = wynik.ostatni;
  }
  const wiersze = zebrane.slice(0, MAKS_WIERSZY_KATALOGU).map(wierszKatalogu);
  return { nazwa: nazwaPliku('katalog', teraz), csv: doCsv(wiersze, KOLUMNY_KATALOGU), wierszy: wiersze.length, obciety };
}

/**
 * Terminy zapisanych przetargów jako plik ICS (etap 5 zostawił go bez drogi do
 * telefonu: aplikacja nie ma modułów do zapisu pliku). Załącznik .ics w poczcie
 * na telefonie otwiera się w kalendarzu jednym dotknięciem.
 */
async function eksportKalendarza(userId, teraz) {
  const kalendarze = await kalendarzeUzytkownika(userId, teraz);
  const wierszy = kalendarze.filter((k) => !k.anulowany).length;
  return { nazwa: `przetargai-terminy-${teraz.slice(0, 10)}.ics`, csv: doIcs(kalendarze, { teraz }), wierszy, obciety: false };
}

function wyslijPlik(res, { nazwa, csv, wierszy, obciety }) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${nazwa}"`);
  res.set('X-Wierszy', String(wierszy));
  res.set('X-Obciety', obciety ? '1' : '0');
  res.send(csv);
}

router.get('/zapisane.csv', ah(async (req, res) => {
  wyslijPlik(res, await eksportZapisanych(req.user.id, nowIso()));
}));

router.get('/katalog.csv', ah(async (req, res) => {
  wyslijPlik(res, await eksportKatalogu(req.query, nowIso()));
}));

const wysylkaSchema = z.object({
  rodzaj: z.enum(['zapisane', 'katalog', 'kalendarz']),
  filtry: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

/**
 * Wysyła eksport na e-mail WŁAŚCICIELA konta — adres bierzemy z konta, nigdy
 * z żądania, więc tej trasy nie da się użyć do wysyłki do obcych.
 */
router.post('/wyslij', ah(async (req, res) => {
  const parsed = wysylkaSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne parametry eksportu', parsed.error.issues);
  if (!req.user.email) throw badRequest('Konto nie ma adresu e-mail.');

  if (!(await limitEksportu.zarezerwuj(req.user.id, LIMIT_WYSYLEK_DZIENNIE))) {
    throw tooMany(`Dzienny limit wysyłek eksportu (${LIMIT_WYSYLEK_DZIENNIE}) wyczerpany — spróbuj jutro.`);
  }

  const teraz = nowIso();
  const { rodzaj } = parsed.data;
  let plik;
  if (rodzaj === 'zapisane') plik = await eksportZapisanych(req.user.id, teraz);
  else if (rodzaj === 'katalog') plik = await eksportKatalogu(parsed.data.filtry ?? {}, teraz);
  else plik = await eksportKalendarza(req.user.id, teraz);

  const tresc = rodzaj === 'kalendarz'
    ? {
      subject: `Terminy Twoich przetargów — ${plik.wierszy} postępowań`,
      text: `W załączniku plik kalendarza (${plik.nazwa}) z terminami ${plik.wierszy} zapisanych postępowań: pytania do SWZ, składanie ofert i koniec związania ofertą. Dotknij załącznika, żeby dodać terminy do kalendarza.`,
      html: `<p>W załączniku plik kalendarza <b>${plik.nazwa}</b> z terminami ${plik.wierszy} zapisanych postępowań: pytania do SWZ, składanie ofert i koniec związania ofertą.</p><p>Dotknij załącznika, żeby dodać terminy do kalendarza.</p>`,
    }
    : {
      subject: `Eksport ${rodzaj === 'zapisane' ? 'zapisanych przetargów' : 'przetargów z katalogu'} — ${plik.wierszy} pozycji`,
      text: `W załączniku plik CSV (${plik.nazwa}) z ${plik.wierszy} pozycjami. Otwórz go w Excelu dwuklikiem.`
        + (plik.obciety ? ` Eksport obcięto do ${MAKS_WIERSZY_KATALOGU} pozycji — zawęź filtry, żeby dostać resztę.` : ''),
      html: `<p>W załączniku plik CSV <b>${plik.nazwa}</b> z ${plik.wierszy} pozycjami. Otwórz go w Excelu dwuklikiem.</p>`
        + (plik.obciety ? `<p>Eksport obcięto do ${MAKS_WIERSZY_KATALOGU} pozycji — zawęź filtry, żeby dostać resztę.</p>` : ''),
    };
  const wynik = await sendEmail({
    to: req.user.email,
    ...tresc,
    attachments: [{ filename: plik.nazwa, content: Buffer.from(plik.csv, 'utf8') }],
  });
  if (!wynik.sent && !wynik.degraded) throw serviceUnavailable('Nie udało się wysłać e-maila — spróbuj za chwilę.');

  res.json({
    wyslano: Boolean(wynik.sent),
    tryb_degradacji: Boolean(wynik.degraded),
    do: req.user.email,
    plik: plik.nazwa,
    wierszy: plik.wierszy,
    obciety: plik.obciety,
  });
}));

export default router;
