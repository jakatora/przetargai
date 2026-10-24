import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { env } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { esc } from '../lib/html.js';
import { users, tenders, matches, evaluations, dziennik, magicLinks } from '../db/repos.js';
import { planEfektywny, stanProby } from '../lib/plan.js';
import { kartaSchema, kartaZUzytkownika, publicKarta, brakiKarty, wersjaKarty } from '../lib/kartaFirmy.js';
import { PRZYCZYNY, PRZYCZYNY_KLIENTA, pustyLicznikPrzyczyn } from '../lib/przyczyny.js';
import { zbudujSygnal } from '../lib/sygnaly.js';
import { propozycjeKarty, zastosujPropozycje, ODLOZENIE_DNI } from '../lib/propozycjeKarty.js';
import { dobaWarszawska, nastepnyPrzebieg, poczatekDobyWarszawskiej } from '../lib/czasPolski.js';
import { kodWojewodztwa } from '../lib/wojewodztwa.js';
import { publicMatch, publicUser, publicOdrzucony, przetargZDopasowania } from '../lib/serialize.js';
import { wyjasnijDopasowanie } from '../lib/wyjasnienieDopasowania.js';
import { pobierzZnacznikiZrodel } from '../services/zakresZrodel.js';
import { przeliczProfil } from '../services/pracownik.js';

/*
 * Selekcja pod klienta — API ekranu „Twoje przetargi” (plans/PRACOWNIK-PROJEKT-2026-10-23.md §9).
 * Plan dostępu pilnowany TUTAJ (planEfektywny), nie tylko w aplikacji.
 */
const router = Router();
const DOBA_MS = 86_400_000;
const ODRZUCONE_DNI = 30;
const CEL_WYPISU = 'wypisz_pracownik';

function stronaWypisu(tresc, formularz = '') {
  return '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>PrzetargAI — maile o przetargach</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#14213d">'
    + `<h1 style="font-size:20px">PrzetargAI</h1><p>${tresc}</p>${formularz}</body></html>`;
}

/*
 * Wypis z maili — BEZ logowania. GET tylko pyta: skanery poczty otwierają linki z maili
 * i jednym GET-em wypisałyby klienta bez jego wiedzy. Wypisuje dopiero POST z przycisku.
 */
router.get('/wypisz', ah(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.slice(0, 200) : '';
  if (!token || !await magicLinks.peek(token, CEL_WYPISU)) {
    res.status(400).type('html').send(stronaWypisu('Link wygasł albo został już użyty. Maile wyłączysz też w aplikacji: Konto → Maile o przetargach.'));
    return;
  }
  res.type('html').send(stronaWypisu('Wyłączyć maile o nowych przetargach dla Twojej firmy?',
    `<form method="post" action="?token=${esc(token)}"><button type="submit" style="padding:12px 20px;font-size:16px">Wyłącz maile</button></form>`));
}));

router.post('/wypisz', ah(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.slice(0, 200) : '';
  const userId = token ? await magicLinks.consume(token, CEL_WYPISU) : null;
  if (!userId) {
    res.status(400).type('html').send(stronaWypisu('Link wygasł albo został już użyty.'));
    return;
  }
  await users.ustawPowiadomieniaEmail(userId, false);
  audit({ userId, action: 'unsubscribe_selection_email', ip: req.ip });
  res.type('html').send(stronaWypisu('Gotowe — nie wyślemy więcej maili o nowych przetargach. Włączysz je w aplikacji: Konto.'));
}));

router.use(authRequired);
router.use((req, res, next) => {
  if (env.PRACOWNIK_ENABLED === 'true') { next(); return; }
  res.status(503).json({ error: 'Funkcja jest chwilowo wyłączona', powod: 'wylaczony' });
});

router.get('/dzien', ah(async (req, res) => {
  const teraz = new Date().toISOString();
  const plan = planEfektywny(req.user, teraz);
  const doba = dobaWarszawska(teraz);
  const [wiersze, dzis, znaczniki] = await Promise.all([
    matches.wybraneOd(req.user.id, poczatekDobyWarszawskiej(teraz)),
    dziennik.pobierz(req.user.id, doba),
    pobierzZnacznikiZrodel(),
  ]);
  const odrzucone = { ...pustyLicznikPrzyczyn(), ...(dzis?.odrzucone ?? {}) };
  res.json({
    plan,
    proba: stanProby(req.user, teraz),
    raport: {
      doba,
      przejrzane: dzis?.przejrzane ?? 0,
      wybrane: dzis?.wybrane ?? 0,
      oczekuje: dzis?.oczekuje ?? 0,
      odrzucone,
      odrzucone_razem: Object.values(odrzucone).reduce((s, n) => s + n, 0),
      ostatni_przebieg_o: req.user.pracownik_ostatni_przebieg ?? null,
      nastepny_przebieg_o: nastepnyPrzebieg(teraz, plan),
    },
    wybrane: wiersze.map((row) => ({
      ...publicMatch(row, znaczniki),
      wyjasnienie: wyjasnijDopasowanie(req.user, przetargZDopasowania(row)),
    })),
    odrzucone: { wg_przyczyny: odrzucone, lista_dostepna: plan === 'standard' },
    propozycje: propozycjeKarty(req.user, teraz),
    braki_karty: brakiKarty(req.user),
  });
}));

router.get('/odrzucone', ah(async (req, res) => {
  const teraz = new Date().toISOString();
  if (planEfektywny(req.user, teraz) !== 'standard') {
    res.json({ odrzucone: [], next_before: null, powod: 'plan' });
    return;
  }
  const przyczyna = PRZYCZYNY.includes(req.query.przyczyna) ? req.query.przyczyna : null;
  const przed = typeof req.query.before === 'string' && req.query.before ? req.query.before.slice(0, 200) : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const od = new Date(Date.parse(teraz) - ODRZUCONE_DNI * DOBA_MS).toISOString();
  const rows = await evaluations.odrzucone(req.user.id, { od, przyczyna, przed, limit });
  res.json({ odrzucone: rows.map(publicOdrzucony), next_before: rows.length === limit ? evaluations.kursorZ(rows.at(-1)) : null });
}));

const odrzucSchema = z.object({
  przyczyna: z.enum(PRZYCZYNY_KLIENTA),
  komentarz: z.string().trim().max(140).optional(),
});

router.post('/odrzuc/:matchId', ah(async (req, res) => {
  const wynik = odrzucSchema.safeParse(req.body);
  if (!wynik.success) throw badRequest('Wybierz przyczynę odrzucenia');
  const teraz = new Date().toISOString();
  const row = await matches.oznaczOdrzuconyPrzezKlienta(req.user.id, req.params.matchId, {
    przyczyna: wynik.data.przyczyna, komentarz: wynik.data.komentarz ?? null, teraz,
  });
  if (!row) throw notFound('Dopasowanie nie zostało znalezione');
  await users.dodajSygnal(req.user.id, zbudujSygnal({
    typ: 'odrzucenie', tenderId: row.tender_id, tytul: row.tender_title, wojewodztwo: kodWojewodztwa(row.tender_wojewodztwo),
    wartosc: row.tender_budget, termin: row.tender_deadline, przyczyna: wynik.data.przyczyna, komentarz: wynik.data.komentarz, teraz,
  }));
  audit({ userId: req.user.id, action: 'reject_match', detail: { matchId: row.id, przyczyna: wynik.data.przyczyna }, ip: req.ip });
  res.json({ ok: true });
}));

router.post('/przywroc/:tenderId', ah(async (req, res) => {
  const teraz = new Date().toISOString();
  if (planEfektywny(req.user, teraz) !== 'standard') {
    res.status(403).json({ error: 'Przywracanie z listy odrzuconych jest w planie Standard', powod: 'plan' });
    return;
  }
  const slad = await evaluations.pobierz(req.user.id, req.params.tenderId);
  if (slad?.decyzja !== 'odrzucony') throw notFound('Tego przetargu nie ma na liście odrzuconych');
  const tender = await tenders.findById(req.params.tenderId);
  if (!tender) throw notFound('Przetarg nie został znaleziony');
  await matches.utworzWybrany({
    userId: req.user.id, tender, score: Math.max(slad.score ?? 0, env.MATCH_CONFIDENCE_THRESHOLD),
    punkty: ['Przywrócony przez Ciebie z listy odrzuconych.'], scorer: 'klient', ocenaBezAi: false,
    criteriaHash: slad.criteria_hash ?? wersjaKarty(req.user), zapiszSlad: true, teraz,
  });
  await users.dodajSygnal(req.user.id, zbudujSygnal({
    typ: 'przywrocenie', tenderId: tender.id, tytul: tender.title, wojewodztwo: kodWojewodztwa(tender.wojewodztwo),
    wartosc: tender.budget, termin: tender.deadline, teraz,
  }));
  audit({ userId: req.user.id, action: 'restore_rejected', detail: { tenderId: tender.id }, ip: req.ip });
  res.json({ ok: true, match_id: tender.id });
}));

router.get('/karta', ah(async (req, res) => {
  res.json({ karta: publicKarta(req.user), braki: brakiKarty(req.user) });
}));

/** Zapis karty + przeliczenie otwartej puli, gdy zmieniła się wersja (spec §3.2). */
async function zapiszIPrzelicz(user, zapis) {
  const przed = wersjaKarty(user);
  const zapisany = await users.zapiszKarte(user.id, zapis);
  if (wersjaKarty(zapisany) !== przed) {
    try {
      const w = await przeliczProfil(zapisany);
      logger.info({ userId: zapisany.id, ...w }, 'Przeliczenie po zmianie karty zakończone');
    } catch (err) {
      // Karta zapisana — cykl dzienny i tak ją uwzględni.
      logger.error({ err: err.message, userId: zapisany.id }, 'Przeliczenie po zmianie karty nieudane');
    }
  }
  return zapisany;
}

router.put('/karta', ah(async (req, res) => {
  const wynik = kartaSchema.safeParse(req.body);
  if (!wynik.success) throw badRequest(wynik.error.issues[0]?.message ?? 'Nieprawidłowa karta firmy');
  const d = wynik.data;
  const obecna = kartaZUzytkownika(req.user);
  const karta = {
    opis: d.opis === undefined ? obecna.opis : (d.opis || null),
    wykluczenia: d.wykluczenia ?? obecna.wykluczenia,
    wartosc_min: d.wartosc_min === undefined ? obecna.wartosc_min : d.wartosc_min,
    min_dni_oferta: d.min_dni_oferta ?? obecna.min_dni_oferta,
    formalne: d.formalne ? { ...obecna.formalne, ...d.formalne } : obecna.formalne,
  };
  const wartoscMax = d.wartosc_max === undefined ? (req.user.wartosc_max ?? null) : d.wartosc_max;
  if (karta.wartosc_min !== null && wartoscMax !== null && karta.wartosc_min > wartoscMax) {
    throw badRequest('Wartość „od” nie może być większa niż „do”');
  }
  const zapisany = await zapiszIPrzelicz(req.user, {
    companyName: d.company_name ?? req.user.company_name ?? null,
    keywords: d.keywords ?? req.user.keywords ?? [],
    cpvCodes: d.cpv_codes ?? req.user.cpv_codes ?? [],
    regiony: d.regiony ? [...new Set(d.regiony.map(kodWojewodztwa).filter(Boolean))] : (req.user.regiony ?? []),
    wartoscMax,
    karta,
  });
  audit({ userId: req.user.id, action: 'update_company_card', ip: req.ip });
  res.json({ karta: publicKarta(zapisany), braki: brakiKarty(zapisany), user: publicUser(zapisany) });
}));

const propozycjaSchema = z.object({ akcja: z.enum(['przyjmij', 'nie_teraz']) });

router.post('/propozycje/:klucz', ah(async (req, res) => {
  const wynik = propozycjaSchema.safeParse(req.body);
  if (!wynik.success) throw badRequest('Wymagane pole "akcja": przyjmij albo nie_teraz');
  const teraz = new Date().toISOString();
  const propozycja = propozycjeKarty(req.user, teraz).find((p) => p.klucz === req.params.klucz);
  if (!propozycja) throw notFound('Ta propozycja nie jest już aktualna');

  if (wynik.data.akcja === 'nie_teraz') {
    await users.odlozPropozycje(req.user.id, propozycja.klucz, new Date(Date.parse(teraz) + ODLOZENIE_DNI * DOBA_MS).toISOString(), teraz);
    res.json({ ok: true });
    return;
  }
  if (propozycja.akcja !== 'zmien') throw badRequest('Tę propozycję uzupełnisz w karcie firmy');
  const zapisany = await zapiszIPrzelicz(req.user, zastosujPropozycje(req.user, propozycja));
  audit({ userId: req.user.id, action: 'accept_card_proposal', detail: { pole: propozycja.pole }, ip: req.ip });
  res.json({ ok: true, karta: publicKarta(zapisany) });
}));

export default router;
