import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { saved, tenders, limitEksportu } from '../db/repos.js';
import { AppError, badRequest, tooMany, serviceUnavailable } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { normalizujFiltry, LIMIT_MAKS } from '../lib/katalogPrzetargow.js';
import {
  doCsv, wierszZapisanego, wierszKatalogu, KOLUMNY_ZAPISANYCH, KOLUMNY_KATALOGU,
  nazwaPliku, MAKS_WIERSZY_KATALOGU,
} from '../lib/eksportCsv.js';
import { sendEmail } from '../services/email.js';
import { doIcs } from '../lib/kalendarzPrzetargu.js';
import { zbudujDocx, nazwaPlikuDocx, TYP_MIME_DOCX } from '../lib/docx.js';
import { wypelnijDocx, pobierzZalacznik, liczbaPol } from '../lib/wypelnijZalacznik.js';
import { esc } from '../lib/html.js';
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

/**
 * Pismo z aplikacji (odpowiedź na wezwanie, wniosek o zwrot wadium, dokumenty do oferty…)
 * jako plik WORD na e-mail właściciela konta (2026-10-25). Treść składa telefon (czyste
 * biblioteki `mobile/src/lib/*`), tu tylko .docx (lib/docx.js) i wysyłka — adres z konta,
 * nigdy z żądania; ten sam dzienny limit co eksporty.
 */
export const MAKS_DL_PISMA = 60_000;
export const MAKS_PISM_W_PAKIECIE = 8;
const jednoPismo = z.object({
  nazwa: z.string().trim().min(1).max(120),
  tresc: z.string().min(1).max(MAKS_DL_PISMA),
});
// Jedno pismo ({nazwa, tresc}) albo PAKIET ({pisma: [...], tytul?}) — jeden e-mail, osobny .docx na pismo.
const pismoSchema = z.union([
  jednoPismo,
  z.object({ pisma: z.array(jednoPismo).min(1).max(MAKS_PISM_W_PAKIECIE), tytul: z.string().trim().min(1).max(160).optional() }),
]);

/** Nazwy plików w pakiecie muszą być różne — dwa „Oświadczenie.docx” w jednym mailu to jeden plik dla odbiorcy. */
export function nazwyPlikowPakietu(pisma) {
  const uzyte = new Map();
  return pisma.map((p) => {
    const baza = nazwaPlikuDocx(p.nazwa);
    const n = (uzyte.get(baza) ?? 0) + 1;
    uzyte.set(baza, n);
    return n === 1 ? baza : baza.replace(/\.docx$/, ` (${n}).docx`);
  });
}

router.post('/pismo', ah(async (req, res) => {
  const parsed = pismoSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne pismo', parsed.error.issues);
  if (!req.user.email) throw badRequest('Konto nie ma adresu e-mail.');
  if (!(await limitEksportu.zarezerwuj(req.user.id, LIMIT_WYSYLEK_DZIENNIE))) {
    throw tooMany(`Dzienny limit wysyłek (${LIMIT_WYSYLEK_DZIENNIE}) wyczerpany — spróbuj jutro.`);
  }
  const pisma = 'pisma' in parsed.data ? parsed.data.pisma : [parsed.data];
  const pliki = nazwyPlikowPakietu(pisma);
  const teraz = new Date(nowIso());
  const temat = 'pisma' in parsed.data
    ? `${parsed.data.tytul ?? 'Dokumenty do oferty'} — ${pliki.length} ${pliki.length === 1 ? 'plik Word' : 'pliki Word'} do podpisu`
    : `${pisma[0].nazwa} — plik Word do podpisu`;
  const listaTekst = pliki.map((p) => `• ${p}`).join('\n');
  const listaHtml = `<ul>${pliki.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  const wynik = await sendEmail({
    to: req.user.email,
    subject: temat,
    text: `W załączniku ${pliki.length === 1 ? 'pismo jako plik Word' : `${pliki.length} pism jako pliki Word`}:\n${listaTekst}\n\nOtwórz na komputerze, sprawdź dane, podpisz kwalifikowanym podpisem i złóż na platformie postępowania.`,
    html: `<p>W załączniku ${pliki.length === 1 ? 'pismo jako plik Word' : `${pliki.length} pism jako pliki Word`}:</p>${listaHtml}<p>Otwórz na komputerze, sprawdź dane, podpisz kwalifikowanym podpisem i złóż na platformie postępowania.</p>`,
    attachments: pisma.map((p, i) => ({ filename: pliki[i], content: zbudujDocx({ nazwa: p.nazwa, tresc: p.tresc, teraz }), contentType: TYP_MIME_DOCX })),
  });
  if (!wynik.sent && !wynik.degraded) throw serviceUnavailable('Nie udało się wysłać e-maila — spróbuj za chwilę.');
  res.json({ wyslano: Boolean(wynik.sent), tryb_degradacji: Boolean(wynik.degraded), do: req.user.email, plik: pliki[0], pliki });
}));

/**
 * To samo pismo jako PLIK do pobrania (web / Windows): przeglądarka zapisuje .docx od razu,
 * bez okrążenia przez skrzynkę. Bez e-maila, więc bez dziennego limitu wysyłek.
 * Nazwa pliku i w ASCII (stare klienty), i w UTF-8 (`filename*`, RFC 5987) — polskie znaki zostają.
 */
router.post('/pismo.docx', ah(async (req, res) => {
  const parsed = jednoPismo.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Niepoprawne pismo', parsed.error.issues);
  const { nazwa, tresc } = parsed.data;
  const plik = nazwaPlikuDocx(nazwa);
  const ascii = plik.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.set('Content-Type', TYP_MIME_DOCX);
  res.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(plik)}`);
  res.set('X-Plik', encodeURIComponent(plik));
  res.send(zbudujDocx({ nazwa, tresc, teraz: new Date(nowIso()) }));
}));

/*
 * Załącznik ZAMAWIAJĄCEGO wypełniony danymi firmy (2026-10-31, z analizy konkurencji: Mimira).
 * Klient podaje adres .docx z dokumentów przetargu (e-Zamówienia / platformazakupowa.pl) i dane
 * firmy wpisane raz w aplikacji; wpisujemy tylko pola rozpoznane z pewnością (lib/wypelnijZalacznik.js),
 * a cenę, terminy i podpis zostawiamy wykonawcy. Dwie drogi jak przy pismach: e-mail na adres
 * z konta (telefon) albo plik do pobrania (web / Windows).
 */
const poleDanych = z.string().trim().max(300).optional();
const zalacznikSchema = z.object({
  url: z.string().trim().min(10).max(800),
  nazwa: z.string().trim().min(1).max(160).optional(),
  dane: z.object({
    nazwa: z.string().trim().min(2).max(300),
    adres: poleDanych, nip: poleDanych, regon: poleDanych, rejestr: poleDanych, reprezentant: poleDanych,
    stanowisko: poleDanych, email: poleDanych, telefon: poleDanych, miejscowosc: poleDanych,
  }),
});

/** Test seam: podmiana pobierania załącznika (testy bez sieci). */
let pobierzZal = pobierzZalacznik;
export function ustawPobieranieZalacznika(fn) { pobierzZal = fn ?? pobierzZalacznik; }

async function wypelnionyZalacznik(body) {
  const parsed = zalacznikSchema.safeParse(body ?? {});
  if (!parsed.success) throw badRequest('Podaj adres załącznika i dane firmy (co najmniej nazwę).', parsed.error.issues);
  let bufor;
  try {
    bufor = await pobierzZal(parsed.data.url);
  } catch (err) {
    throw new AppError(err.status ?? 502, 'ZALACZNIK', err.message);
  }
  let wynik;
  try {
    wynik = wypelnijDocx(bufor, parsed.data.dane, { dzis: nowIso().slice(0, 10), teraz: new Date(nowIso()) });
  } catch (err) {
    throw new AppError(422, 'ZALACZNIK', `Nie udało się odczytać pliku Word: ${err.message}`);
  }
  const plik = nazwaPlikuDocx(`${(parsed.data.nazwa ?? 'Załącznik').replace(/\.docx?$/i, '')} - wypełniony`);
  return { ...wynik, plik_nazwa: plik };
}

router.post('/zalacznik', ah(async (req, res) => {
  if (!req.user.email) throw badRequest('Konto nie ma adresu e-mail.');
  const w = await wypelnionyZalacznik(req.body);
  if (!(await limitEksportu.zarezerwuj(req.user.id, LIMIT_WYSYLEK_DZIENNIE))) {
    throw tooMany(`Dzienny limit wysyłek (${LIMIT_WYSYLEK_DZIENNIE}) wyczerpany — spróbuj jutro.`);
  }
  const doUzup = w.do_uzupelnienia.slice(0, 15);
  const listaTekst = doUzup.map((d) => `• ${d.etykieta} — ${d.powod}`).join('\n');
  const listaHtml = doUzup.length ? `<p>Do uzupełnienia przez Ciebie:</p><ul>${doUzup.map((d) => `<li>${esc(d.etykieta)} — ${esc(d.powod)}</li>`).join('')}</ul>` : '';
  const wynik = await sendEmail({
    to: req.user.email,
    subject: `${w.plik_nazwa} — wpisaliśmy ${liczbaPol(w.wypelnione.length)}`,
    text: `W załączniku formularz zamawiającego z wpisanymi danymi firmy (${liczbaPol(w.wypelnione.length)}).`
      + (doUzup.length ? `\n\nDo uzupełnienia przez Ciebie:\n${listaTekst}` : '')
      + '\n\nSprawdź dane, wpisz cenę i podpisz kwalifikowanym podpisem przed złożeniem.',
    html: `<p>W załączniku formularz zamawiającego z wpisanymi danymi firmy (${liczbaPol(w.wypelnione.length)}).</p>${listaHtml}<p>Sprawdź dane, wpisz cenę i podpisz kwalifikowanym podpisem przed złożeniem.</p>`,
    attachments: [{ filename: w.plik_nazwa, content: w.plik, contentType: TYP_MIME_DOCX }],
  });
  if (!wynik.sent && !wynik.degraded) throw serviceUnavailable('Nie udało się wysłać e-maila — spróbuj za chwilę.');
  res.json({
    wyslano: Boolean(wynik.sent), tryb_degradacji: Boolean(wynik.degraded), do: req.user.email, plik: w.plik_nazwa,
    wypelnione: w.wypelnione, do_uzupelnienia: w.do_uzupelnienia,
  });
}));

router.post('/zalacznik.docx', ah(async (req, res) => {
  const w = await wypelnionyZalacznik(req.body);
  const ascii = w.plik_nazwa.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.set('Content-Type', TYP_MIME_DOCX);
  res.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(w.plik_nazwa)}`);
  res.set('X-Plik', encodeURIComponent(w.plik_nazwa));
  res.set('X-Wypelnione', String(w.wypelnione.length));
  res.set('X-Do-Uzupelnienia', encodeURIComponent(JSON.stringify(w.do_uzupelnienia.slice(0, 8).map((d) => d.etykieta))));
  res.send(w.plik);
}));
