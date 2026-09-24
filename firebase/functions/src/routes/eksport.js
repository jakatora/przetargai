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

/** Katalog z filtrami jak GET /tenders — strona po stronie, do sufitu wierszy. */
async function eksportKatalogu(query, teraz) {
  const filtry = { ...normalizujFiltry(query ?? {}), limit: LIMIT_MAKS };
  const zebrane = [];
  let kursor = null;
  let obciety = false;
  for (;;) {
    const wynik = await tenders.katalog({ filtry, teraz, kursor });
    zebrane.push(...wynik.wiersze);
    if (zebrane.length >= MAKS_WIERSZY_KATALOGU) { obciety = true; break; }
    if (!wynik.ostatni || wynik.wiersze.length === 0) break;
    kursor = wynik.ostatni;
  }
  const wiersze = zebrane.slice(0, MAKS_WIERSZY_KATALOGU).map(wierszKatalogu);
  return { nazwa: nazwaPliku('katalog', teraz), csv: doCsv(wiersze, KOLUMNY_KATALOGU), wierszy: wiersze.length, obciety };
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
  rodzaj: z.enum(['zapisane', 'katalog']),
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
  const plik = parsed.data.rodzaj === 'zapisane'
    ? await eksportZapisanych(req.user.id, teraz)
    : await eksportKatalogu(parsed.data.filtry ?? {}, teraz);

  const opis = parsed.data.rodzaj === 'zapisane' ? 'zapisanych przetargów' : 'przetargów z katalogu';
  const wynik = await sendEmail({
    to: req.user.email,
    subject: `Eksport ${opis} — ${plik.wierszy} pozycji`,
    text: `W załączniku plik CSV (${plik.nazwa}) z ${plik.wierszy} pozycjami. Otwórz go w Excelu dwuklikiem.`
      + (plik.obciety ? ` Eksport obcięto do ${MAKS_WIERSZY_KATALOGU} pozycji — zawęź filtry, żeby dostać resztę.` : ''),
    html: `<p>W załączniku plik CSV <b>${plik.nazwa}</b> z ${plik.wierszy} pozycjami. Otwórz go w Excelu dwuklikiem.</p>`
      + (plik.obciety ? `<p>Eksport obcięto do ${MAKS_WIERSZY_KATALOGU} pozycji — zawęź filtry, żeby dostać resztę.</p>` : ''),
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
