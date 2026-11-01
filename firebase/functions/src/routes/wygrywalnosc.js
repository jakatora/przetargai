import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { tenders, users, benchmarkRynku, powiazaniaSwz, rozstrzygniecia, limitPytanSwz, umowyWygasajace } from '../db/repos.js';
import { kluczeUmowUzytkownika, wybierzUmowy, twojeUmowy, HORYZONT_DNI } from '../lib/umowyWygasajace.js';
import { planEfektywny } from '../lib/plan.js';
import { ktoWygrywa } from '../lib/ktoWygrywa.js';
import { kluczePartnerow, wybierzPartnerow } from '../lib/partnerzy.js';
import { kryteriaPrzetargu } from '../lib/ogloszenieMeta.js';
import { profilKonkurenta, normNip, twoiKonkurenci, kluczeKonkurentowUzytkownika } from '../lib/profilKonkurenta.js';
import { AppError, badRequest, conflict, notFound, serviceUnavailable, tooMany } from '../lib/errors.js';
import { features } from '../config.js';
import { logger } from '../lib/logger.js';
import { zapytajModulPrzetargowy, wywolajModulPrzetargowy } from '../services/mostRailway.js';
import { dokumentyPrzetargu, wybierzSwz, pobierzPdfBase64 } from '../jobs/autoAnalizaSwz.js';
import { pobierzDokumenty as pobierzDokumentyEz, czyIdPostepowania } from '../services/eZamowieniaDokumenty.js';
import { zbudujChecklisteOferty } from '../lib/checklistaOferty.js';
import { zbudujKalendarz } from '../lib/kalendarzPrzetargu.js';
import { zbudujKarteStartu, kluczeBenchmarku, rozstrzygniecieTegoPostepowania } from '../services/kartaStartu.js';

/*
 * Wygrywalność (etap 6) — „czy warto tu startować" i benchmark rynku.
 *
 * Osobno od `/tenders`, bo katalog jest z zasady BEZSTANOWY (nie czyta profilu),
 * a ta karta profil czyta: maksymalna wartość kontraktu decyduje o tym, czy
 * typowa cena w tej grupie jest dla firmy osiągalna, czy poza zasięgiem.
 *
 * 🚨 BEZ PŁATNEGO AI. Karta ma się otwierać przy każdym ogłoszeniu, tak jak
 * katalog, więc musi być darmowa w odczycie: jeden `getAll` po gotowe kubełki
 * benchmarku, liczone w jobie `benchmarkPrzelicz`.
 */

const router = Router();
router.use(authRequired);

/** Pola profilu, które wchodzą do karty. Reszta profilu jej nie dotyczy. */
function profilDoKarty(user) {
  return { wartosc_max: user?.wartosc_max ?? null, regiony: user?.regiony ?? null };
}

/**
 * Karta „Czy warto startować?" dla przetargu z katalogu.
 *
 * Gdy postępowanie ma już rozstrzygnięcie, oddajemy je zamiast karty — nie ma
 * czego rozważać, a pokazywanie czynników sugerowałoby, że jeszcze można złożyć.
 */
router.get('/tender/:id', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');

  const [user, rozstrzygniecie] = await Promise.all([
    users.findById(req.user.id),
    rozstrzygniecieTegoPostepowania(tender),
  ]);

  if (rozstrzygniecie) {
    res.json({
      stan: 'rozstrzygniete',
      rozstrzygniecie: {
        zrodlo: rozstrzygniecie.zrodlo,
        opublikowano: rozstrzygniecie.opublikowano,
        czesci: rozstrzygniecie.czesci ?? [],
      },
      karta: null,
    });
    return;
  }

  const karta = await zbudujKarteStartu({
    tender, profil: profilDoKarty(user), teraz: Date.now(),
  });
  res.json({ stan: 'otwarte', karta, rozstrzygniecie: null });
}));

/**
 * Surowe kubełki benchmarku dla przetargu — zamawiający, dział w regionie, dział w kraju.
 *
 * Karta oddaje WNIOSEK; to jest materiał, z którego powstał. Bez tego ekranu
 * „skąd to wiecie" nie da się odpowiedzieć niczym poza „zaufaj nam".
 */
router.get('/tender/:id/benchmark', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');

  const klucze = kluczeBenchmarku(tender);
  const kubelki = await benchmarkRynku.pobierzWiele(Object.values(klucze));
  res.json({
    klucze,
    benchmark: {
      zamawiajacy: klucze.zamawiajacy ? kubelki[klucze.zamawiajacy] ?? null : null,
      dzial_region: klucze.dzialRegion ? kubelki[klucze.dzialRegion] ?? null : null,
      dzial_kraj: klucze.dzialKraj ? kubelki[klucze.dzialKraj] ?? null : null,
    },
  });
}));

/*
 * Kto może użyczyć doświadczenia (2026-10-31): firmy, które w ostatnim roku wygrywały zamówienia tej
 * samej klasy CPV (region → kraj → dział w regionie), bez własnej firmy. Partner do konsorcjum,
 * podwykonawca albo podmiot udostępniający zasoby (art. 118 Pzp). Szczegóły: `lib/partnerzy.js`.
 */
router.get('/tender/:id/partnerzy', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');
  const klucze = kluczePartnerow(tender);
  const kubelki = klucze.length ? await benchmarkRynku.pobierzWiele(klucze.map((k) => k.klucz)) : {};
  res.json(wybierzPartnerow({ klucze, kubelki, wlasnyNip: req.user.company_nip ?? null }));
}));

/*
 * Za co są punkty (2026-10-31): kryteria oceny z wagami z ogłoszenia BZP (pole `kryteria`,
 * `lib/ogloszenieMeta.js`). Darmowe w odczycie jak reszta tej karty — zero AI.
 */
router.get('/tender/:id/kryteria', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');
  res.json(kryteriaPrzetargu(tender));
}));

/*
 * „Kto tu wygrywa” (2026-10-31): zwycięzcy i ostatnie rozstrzygnięcia TEGO zamawiającego (po NIP-ie)
 * z kolekcji `rozstrzygniecia`. Uzupełnia benchmark (ile ofert, jaka cena) o to, z KIM się startuje.
 * Bez NIP-u zamawiającego (np. platformy zakupowe) — `dostepne: false` z powodem, nie błąd.
 */
router.get('/tender/:id/kto-wygrywa', ah(async (req, res) => {
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');
  const nip = tender.zamawiajacy_nip ?? null;
  if (!nip) {
    res.json({ dostepne: false, powod: 'brak_nip_zamawiajacego', zamawiajacy: tender.organization ?? null });
    return;
  }
  const wyniki = await rozstrzygniecia.dlaZamawiajacego(nip, { limit: 200 });
  res.json({ dostepne: true, zamawiajacy: tender.organization ?? null, ...ktoWygrywa(wyniki) });
}));

/*
 * „Zapytaj SWZ” przy DOWOLNYM przetargu (2026-10-31): nie trzeba najpierw wchodzić do Radaru SWZ.
 * Gdy przetarg nie ma jeszcze powiązanej analizy, sami bierzemy SWZ w PDF z dokumentów (e-Zamówienia
 * albo platformazakupowa.pl), zakładamy postępowanie na Railway, zapisujemy tekst BEZ płatnej analizy
 * (`/tresc-pdf`) i wiążemy z przetargiem — każde następne pytanie idzie od razu. Koszt pilnują bramki
 * Railway (budżet AI i dobowy limit użytkownika); pytanie bez SWZ w PDF → 409 z instrukcją.
 */
const wejsciePytania = z.object({ pytanie: z.string().trim().min(3).max(500) });
export const LIMIT_PYTAN_SWZ_DARMOWY = 3;

async function postepowanieZTrescia(user, tender) {
  let dokumenty = dokumentyPrzetargu(tender);
  if (!dokumenty.length && tender.source === 'bzp' && czyIdPostepowania(tender.postepowanie_id)) {
    dokumenty = await pobierzDokumentyEz(tender.postepowanie_id);
    await tenders.zapiszDokumentyEz(tender.id, dokumenty);
  }
  const swz = wybierzSwz(dokumenty);
  if (!swz) throw conflict('W dokumentach tego przetargu nie ma SWZ w PDF. Otwórz Radar SWZ i wklej treść specyfikacji — wtedy odpowiemy.');
  let pdf;
  try {
    pdf = await pobierzPdfBase64(swz.url);
  } catch (err) {
    throw new AppError(502, 'SWZ_NIEDOSTEPNA', `Nie udało się pobrać SWZ: ${err.message}`);
  }
  const nowe = await wywolajModulPrzetargowy(user, {
    metoda: 'POST', sciezka: '/swz/postepowania',
    dane: { nazwa: String(tender.title ?? 'Przetarg').slice(0, 300), ...(tender.deadline ? { termin_skladania_ofert: tender.deadline } : {}) },
  });
  const postepowanieId = nowe.dane?.postepowanie?.id;
  if (nowe.status !== 201 || !postepowanieId) throw new AppError(502, 'MOST_NIEDOSTEPNY', 'Moduł analizy SWZ jest chwilowo niedostępny. Spróbuj za chwilę.');
  const tresc = await wywolajModulPrzetargowy(user, { metoda: 'POST', sciezka: `/swz/postepowania/${postepowanieId}/tresc-pdf`, dane: { swz_pdf_base64: pdf }, limitMs: 60_000 });
  if (tresc.status !== 200) throw new AppError(tresc.status >= 500 ? 502 : tresc.status, 'SWZ_NIECZYTELNA', tresc.dane?.error?.message ?? 'Nie udało się odczytać tekstu SWZ.');
  await powiazaniaSwz.ustaw(user.id, tender.id, { postepowanieId, nazwa: String(tender.title ?? '').slice(0, 300) || null });
  return postepowanieId;
}

router.post('/tender/:id/zapytaj-swz', ah(async (req, res) => {
  const parsed = wejsciePytania.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Wpisz pytanie do SWZ (od 3 do 500 znaków).');
  if (!features.most) throw serviceUnavailable('Moduł analizy SWZ jest chwilowo wyłączony');
  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');
  if (planEfektywny(req.user) !== 'standard' && !(await limitPytanSwz.zarezerwuj(req.user.id, LIMIT_PYTAN_SWZ_DARMOWY))) {
    throw tooMany(`W planie darmowym możesz zadać ${LIMIT_PYTAN_SWZ_DARMOWY} pytania do SWZ dziennie. W planie Standard pytasz bez tego limitu.`);
  }

  const powiazanie = await powiazaniaSwz.pobierz(req.user.id, tender.id);
  let postepowanieId = powiazanie?.postepowanie_id ?? null;
  const pytaj = (id) => wywolajModulPrzetargowy(req.user, { metoda: 'POST', sciezka: `/swz/postepowania/${id}/zapytaj`, dane: { pytanie: parsed.data.pytanie }, limitMs: 60_000 });
  let odp = postepowanieId ? await pytaj(postepowanieId) : null;
  // Brak powiązania, analiza usunięta (404) albo bez treści (409) → treść z PDF-a i jeszcze raz.
  if (!odp || odp.status === 404 || odp.status === 409) {
    postepowanieId = await postepowanieZTrescia(req.user, tender);
    odp = await pytaj(postepowanieId);
  }
  res.status(odp.status).json({ ...(odp.dane ?? {}), postepowanie_id: postepowanieId });
}));

/*
 * Profil konkurenta (2026-10-31): co wygrywa jedna firma u wszystkich zamawiających (BZP po NIP-ie,
 * TED po nazwie). Wejście z karty „Kto wygrywa” — klient dotyka zwycięzcy i widzi jego profil.
 */
const wejscieWykonawcy = z.object({
  nip: z.string().max(20).optional(),
  nazwa: z.string().trim().max(300).optional(),
});

router.get('/wykonawca', ah(async (req, res) => {
  const parsed = wejscieWykonawcy.safeParse(req.query ?? {});
  const nip = parsed.success ? normNip(parsed.data.nip) : null;
  const nazwa = parsed.success && parsed.data.nazwa && parsed.data.nazwa.length >= 3 ? parsed.data.nazwa : null;
  if (!nip && !nazwa) throw badRequest('Podaj NIP wykonawcy (10 cyfr) albo jego nazwę');
  const wyniki = await rozstrzygniecia.dlaWykonawcy({ nip, nazwa });
  res.json(profilKonkurenta(wyniki, { nip, nazwa }));
}));

/*
 * Twoi konkurenci (2026-10-31): kto najczęściej wygrywa w branżach i regionach z karty firmy —
 * z kubełków benchmarku, bez dodatkowego skanu rozstrzygnięć. Bez kodów CPV w karcie nie ma z czego.
 */
/*
 * Radar wygasających umów (2026-10-31): umowy z branż i regionów karty firmy, które kończą się
 * w ciągu ~7 miesięcy — zamawiający niedługo ogłosi ten sam przetarg. Gotowe kubełki z joba
 * `umowyWygasajacePrzelicz`, zero AI. Bez CPV w karcie — `dostepne: false`, nie błąd.
 */
/**
 * Umowy, które firma SAMA wykonuje i które się kończą (2026-11-01), z następcą, jeśli zamawiający już
 * ogłosił nowy przetarg. Bez NIP-u w koncie — null (ekran podpowiada, żeby go podać). Odczyt na żywo:
 * kilkaset wygranych firmy + ogłoszenia ich zamawiających (po NIP-ie, bez indeksu złożonego).
 */
async function umowyFirmy(user, teraz = Date.now()) {
  if (!user.company_nip) return null;
  const wyniki = await rozstrzygniecia.umowyWykonawcy(user.company_nip, { od: new Date(teraz).toISOString().slice(0, 10) });
  const nipy = [...new Set(wyniki.map((w) => w.zamawiajacyNip ?? w.zamawiajacy_nip).filter(Boolean))].slice(0, 40);
  const otwarte = (await Promise.all(nipy.map(async (nip) => (await tenders.poNipieZamawiajacego(nip, { limit: 300 }))
    .map((t) => ({ ...t, zamawiajacy_nip: nip }))))).flat();
  return twojeUmowy({ wyniki, otwarte, teraz });
}

router.get('/umowy-wygasajace', ah(async (req, res) => {
  const { dzialy, regiony, klucze } = kluczeUmowUzytkownika(req.user);
  // Własne umowy nie zależą od CPV w karcie — firma z NIP-em widzi je i bez branż.
  const twoje = await umowyFirmy(req.user).catch((err) => {
    logger.warn({ err: err.message, userId: req.user.id }, 'Radar umów: nie odczytano umów firmy');
    return null;
  });
  if (!dzialy.length) {
    res.json({ dostepne: false, powod: 'brak_cpv_w_karcie', umowy: [], twoje });
    return;
  }
  const kubelki = await umowyWygasajace.pobierzWiele(klucze);
  const { umowy, w_kubelkach: wKubelkach, juz_ogloszone: juzOgloszone } = wybierzUmowy({ kubelki, wlasnyNip: req.user.company_nip ?? null });
  res.json({ dostepne: true, dzialy, regiony, horyzont_dni: HORYZONT_DNI, w_kubelkach: wKubelkach, juz_ogloszone: juzOgloszone, umowy, twoje });
}));

router.get('/moi-konkurenci', ah(async (req, res) => {
  const { dzialy, regiony, klucze } = kluczeKonkurentowUzytkownika(req.user);
  if (!dzialy.length) {
    res.json({ dostepne: false, powod: 'brak_cpv_w_karcie', zakresy: [], konkurenci: [] });
    return;
  }
  const kubelki = await benchmarkRynku.pobierzWiele(klucze);
  res.json({ dostepne: true, ...twoiKonkurenci({ dzialy, regiony, kubelki, wlasnyNip: req.user.company_nip ?? null }) });
}));

/*
 * Checklista „co musisz mieć do dnia składania".
 *
 * BEZSTANOWA z rozmysłem: wymagania postępowania (Radar SWZ) i stan sejfu
 * dokumentów mieszkają w OSOBNEJ usłudze, a ten endpoint nie ma prawa ich
 * kształtu zgadywać ani po cichu pobierać. Klient podaje je w żądaniu, my
 * dokładamy jedyną rzecz, której tamta usługa nie zna: DZIEŃ SKŁADANIA
 * z kalendarza postępowania — i to on decyduje, czy dokument „ważny dzisiaj"
 * będzie ważny wtedy, kiedy trzeba.
 *
 * Dzięki tej granicy checklista działa też wtedy, gdy Radar SWZ albo Sejf są
 * chwilowo nieosiągalne: `stanWiedzy` mówi wprost, czego nie wiemy, zamiast
 * pokazywać zero braków.
 */
const wejscieChecklisty = z.object({
  wymagania: z.array(z.object({}).passthrough()).max(200).optional(),
  dokumenty: z.array(z.object({}).passthrough()).max(500).optional(),
});

router.post('/tender/:id/checklista', ah(async (req, res) => {
  const parsed = wejscieChecklisty.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Nieprawidłowe wejście checklisty');

  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');

  const teraz = Date.now();
  const checklista = zbudujChecklisteOferty({
    tender,
    wymagania: parsed.data.wymagania ?? [],
    dokumenty: parsed.data.dokumenty ?? [],
    teraz,
  });

  res.json({
    checklista,
    // Kalendarz trzech terminów obok checklisty: pytania do SWZ mają własny,
    // WCZEŚNIEJSZY termin niż składanie, a to on zwykle przepada niezauważony.
    kalendarz: zbudujKalendarz(tender, { teraz: new Date(teraz).toISOString() }),
  });
}));

/*
 * Powiązanie analizy SWZ z TYM przetargiem (audyt 2026-09-29).
 *
 * Checklista nigdy nie znała wymagań, bo nic nie łączyło przetargu z analizą SWZ
 * z Radaru. Użytkownik wskazuje analizę jawnie; zapis leży w jego zakresie
 * (users/{uid}/powiazania_swz/{tenderId}), a PRZED zapisem most pyta Railway
 * o tę analizę na koncie użytkownika — cudza odpowiada 404 i nic nie powstaje.
 * Wymagania dociąga potem klient z dopasowania sejf↔SWZ (Railway), bo ten
 * endpoint checklisty jest z założenia bezstanowy (patrz wyżej).
 */
const wejsciePowiazania = z.object({
  // Identyfikator z Radaru SWZ; znaki spoza wzorca (ukośniki, kropki) nie mają
  // prawa dojść do ścieżki mostu.
  postepowanie_id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
});

router.get('/tender/:id/swz', ah(async (req, res) => {
  res.json({ powiazanie: await powiazaniaSwz.pobierz(req.user.id, req.params.id) });
}));

router.put('/tender/:id/swz', ah(async (req, res) => {
  const parsed = wejsciePowiazania.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Nieprawidłowy identyfikator analizy SWZ');

  const tender = await tenders.findById(req.params.id);
  if (!tender) throw notFound('Przetarg nie został znaleziony');
  if (!features.most) throw serviceUnavailable('Moduł analizy SWZ jest chwilowo wyłączony');

  const postepowanieId = parsed.data.postepowanie_id;
  let wynik;
  try {
    wynik = await zapytajModulPrzetargowy(req.user, { sciezka: `/swz/postepowania/${postepowanieId}` });
  } catch (err) {
    logger.error({ err: err.message, uid: req.user.id }, 'Powiązanie SWZ: most niedostępny');
    throw new AppError(502, 'MOST_NIEDOSTEPNY', 'Moduł analizy SWZ jest chwilowo niedostępny. Spróbuj za chwilę.');
  }
  if (wynik.status === 404) throw notFound('Nie znaleziono tej analizy SWZ na Twoim koncie');
  if (wynik.status !== 200 || !wynik.dane?.postepowanie) {
    logger.error({ status: wynik.status, uid: req.user.id }, 'Powiązanie SWZ: nieoczekiwana odpowiedź modułu');
    throw new AppError(502, 'MOST_NIEDOSTEPNY', 'Moduł analizy SWZ odpowiedział nieoczekiwanie. Spróbuj za chwilę.');
  }

  const powiazanie = await powiazaniaSwz.ustaw(req.user.id, tender.id, {
    postepowanieId,
    nazwa: typeof wynik.dane.postepowanie.nazwa === 'string' ? wynik.dane.postepowanie.nazwa : null,
  });
  res.json({ powiazanie });
}));

router.delete('/tender/:id/swz', ah(async (req, res) => {
  await powiazaniaSwz.usun(req.user.id, req.params.id);
  res.json({ powiazanie: null });
}));

export default router;
