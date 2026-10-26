import { env, features } from '../config.js';
import { nowIso } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { heuristicScore } from '../lib/scoring.js';
import { planEfektywny } from '../lib/plan.js';
import { wersjaKarty, formalnePuste, wersjaFormalnych } from '../lib/kartaFirmy.js';
import { sprawdzReguly } from '../lib/regulyKarty.js';
import { przykladyDlaAi } from '../lib/sygnaly.js';
import { pustyLicznikPrzyczyn } from '../lib/przyczyny.js';
import { dobaWarszawska } from '../lib/czasPolski.js';
import {
  AI_PREFILTER_MIN, AI_CALLS_PER_DAY, CANDIDATE_HEAD, OKNO_KANDYDATOW, MAKS_PRZEJRZANYCH,
} from '../lib/limityAi.js';
import { users, tenders, matches, evaluations, aiQuota, dziennik, warunkiQuota, backfillCooldown } from '../db/repos.js';
import { ocenDlaKlienta, porownajWarunki } from './ai.js';
import { backfillUser, generateMatchesForAllUsers } from './matching.js';
import { powiadomPoPrzebiegu } from './powiadomieniaSelekcji.js';
import { pobierzSzczegol as pobierzSzczegolPzDomyslnie, ZRODLO as ZRODLO_PZ } from './platformaZakupowa.js';
import { pobierzDokumenty as pobierzDokumentyEzDomyslnie, czyIdPostepowania } from './eZamowieniaDokumenty.js';

/** Ile szczegółów platformazakupowa.pl dociągamy w JEDNYM przebiegu (żądania do obcego serwisu). */
export const MAKS_SZCZEGOLOW_PZ_NA_PRZEBIEG = 10;
/** Nowo wybrane ogłoszenia BZP dostają od razu listę dokumentów z e-Zamówień (SWZ gotowy do Radaru) — budżet żądań na przebieg. */
export const MAKS_DOKUMENTOW_EZ_NA_PRZEBIEG = 10;

/*
 * Selekcja przetargów pod klienta (plans/PRACOWNIK-PROJEKT-2026-10-23.md §4).
 *
 * Lejek: sygnał tematyczny (heurystyka) → twarde reguły karty (bez kosztu, odrzucenie
 * z przyczyną) → ranking → AI z kartą firmy i przykładami dla czołówki. Bezpieczniki
 * kosztowe te same co w services/matching.js. Każda decyzja ostateczna zostawia ślad
 * w `evaluations` przypięty do WERSJI KARTY — zmiana karty = przegląd od nowa.
 */
export const LIMIT_WARUNKOW_DZIENNIE = 20;
/** Tyle nieudanych wywołań AI z rzędu i przebieg przestaje pytać AI (awaria Anthropic, twardy limit budżetu). */
export const MAKS_KOLEJNYCH_BLEDOW_AI = 3;
/**
 * Budżet czasu przeliczeń, na które ktoś czeka (rejestracja, zapis karty, propozycja, zakup). Konto
 * w próbie jest Standard — bez budżetu rejestracja czekałaby na ~30 ocen AI (60+ s, limit apki 60 s).
 * Resztę kandydatów oceni najbliższy przebieg (Standard co 3 h, Free 12:00); raport pokazuje „czeka”.
 */
export const BUDZET_PRZELICZENIA_MS = 20_000;

function punktyZHeurystyki(h) {
  const punkty = [];
  if (h.matchedKeywords.length) punkty.push(`Tytuł trafia w Twoje słowa: ${h.matchedKeywords.join(', ')}.`);
  if (h.cpvMatched) punkty.push('Kod CPV zgodny z Twoim profilem.');
  if (h.cpvZNazw?.length) punkty.push(`Ogłoszenie bez kodów CPV, ale tytuł pasuje do nazwy Twojego kodu: ${h.cpvZNazw.join(', ')}.`);
  return punkty.length ? punkty : ['Słaby sygnał z profilu.'];
}

/** Standard: porównanie warunków dla świeżo wybranego. true = przetarg ODPADŁ (nie spełnia). */
async function odpadaNaWarunkach(user, tenderId, { porownaj, teraz, wersja }) {
  if (formalnePuste(user)) return false;
  const pelny = await tenders.findById(tenderId);
  const tekst = pelny?.warunki_udzialu?.tekst;
  if (!tekst) return false;
  if (!await warunkiQuota.reserve(user.id, LIMIT_WARUNKOW_DZIENNIE)) return false;

  const wynik = await porownaj(user, tekst);
  if (!wynik) return false;
  await matches.zapiszWarunki(user.id, tenderId, { ...wynik, wersja_formalnych: wersjaFormalnych(user), o: teraz });
  if (wynik.werdykt !== 'nie_spelniasz') return false;

  const braki = wynik.wymagania.filter((w) => w.status === 'brak').map((w) => w.wymog).join('; ');
  await matches.oznaczOdrzuconyPrzezPracownika(user.id, tenderId, {
    przyczyna: 'warunki', etap: 'warunki', criteriaHash: wersja, teraz,
    szczegol: { pl: `Nie spełniasz: ${braki}.`, en: `Not met: ${braki}.` },
  });
  return true;
}

/**
 * Jeden przebieg selekcji dla jednego klienta.
 * @param {object} user dokument użytkownika (z kartą i sygnałami)
 * @param {object[]} pool otwarte przetargi (POLA_PULI) — czytane RAZ dla wszystkich
 * @param {{teraz?: string, ocen?: Function, porownaj?: Function, stanAi?: {kolejneBledy: number}}} [opcje]
 *   AI wstrzykiwane w testach; `stanAi` — bezpiecznik wspólny dla całego przebiegu (wszyscy klienci);
 *   `budzetMs` — po tym czasie kandydaci czekają (bez AI i bez porównania warunków)
 */
export async function pracujDlaUzytkownika(user, pool, {
  teraz = nowIso(), ocen = ocenDlaKlienta, porownaj = porownajWarunki, stanAi = { kolejneBledy: 0 }, budzetMs = Infinity,
  szczegolPz = pobierzSzczegolPzDomyslnie, budzetSzczegolowPz = { pozostalo: MAKS_SZCZEGOLOW_PZ_NA_PRZEBIEG },
  dokumentyEz = pobierzDokumentyEzDomyslnie, budzetDokumentowEz = { pozostalo: MAKS_DOKUMENTOW_EZ_NA_PRZEBIEG },
} = {}) {
  const koniec = Date.now() + budzetMs;
  const poCzasie = () => Date.now() >= koniec;
  const wynik = { przejrzane: 0, wybrane: 0, oczekuje: 0, odrzucone: pustyLicznikPrzyczyn(), aiCalls: 0, nowe: [] };
  if (!user.keywords?.length && !user.cpv_codes?.length) return wynik;

  const plan = planEfektywny(user, teraz);
  const wersja = wersjaKarty(user);
  const pelnyPrzeglad = !user.pracownik_ostatni_przebieg || user.pracownik_wersja !== wersja;
  const czyNowy = (t) => pelnyPrzeglad || String(t.fetched_at ?? '') > user.pracownik_ostatni_przebieg;

  let budzetWybranych = plan === 'free'
    ? Math.max(0, env.FREE_TIER_DAILY_MATCH_LIMIT - await matches.countToday(user.id))
    : Infinity;

  // Pełny przegląd: wcześniejsze dopasowania, które teraz odpadają, schodzą z listy (poza zapisanymi).
  const doSchowania = pelnyPrzeglad ? await matches.doSchowaniaPrzyPrzegladzie(user.id) : new Set();
  const schowaj = async (tenderId, przyczyna, szczegol = null) => {
    // „Termin” nie chowa: za mało dni to nie powód, żeby zabrać przetarg, który klient już zna.
    if (przyczyna === 'termin' || !doSchowania.has(tenderId)) return;
    doSchowania.delete(tenderId);
    await matches.schowajOdrzucony(user.id, tenderId, { przyczyna, szczegol, teraz });
  };

  const ranked = [];
  for (const tender of pool) {
    const nowy = czyNowy(tender);
    if (nowy) wynik.przejrzane++;
    const h = heuristicScore(user, tender);
    if (h.score > 0) ranked.push({ tender, h });
    else {
      if (nowy) wynik.odrzucone.branza++;
      await schowaj(tender.id, 'branza');
    }
  }
  ranked.sort((a, b) => b.h.score - a.h.score);

  // Świeży = bez AKTUALNEJ decyzji przy tej wersji karty (odrzucenie „termin” sprzed przedłużenia
  // terminu nie liczy się — lib/swiezoscOceny.js). Oknami — jak w services/matching.js.
  const swiezi = [];
  for (let start = 0; start < ranked.length && swiezi.length < CANDIDATE_HEAD; start += OKNO_KANDYDATOW) {
    const okno = ranked.slice(start, start + OKNO_KANDYDATOW);
    const ocenione = await evaluations.idsAktualne(user.id, okno.map((x) => x.tender), wersja);
    for (const k of okno) if (!ocenione.has(k.tender.id)) swiezi.push(k);
    if (start + OKNO_KANDYDATOW >= MAKS_PRZEJRZANYCH) break;
  }

  const limitAi = AI_CALLS_PER_DAY[plan];
  let budzetAi = features.ai
    ? Math.min(env.AI_RERANK_TOP_N, Math.max(0, limitAi - await aiQuota.used(user.id)))
    : 0;
  const przyklady = przykladyDlaAi(user.pracownik_sygnaly);
  const prog = env.MATCH_CONFIDENCE_THRESHOLD;

  const odrzuc = async (tender, { przyczyna, etap, szczegol = null, score = null, scorer = null }) => {
    await evaluations.zapiszDecyzje(user.id, tender.id, {
      decyzja: 'odrzucony', przyczyna, etap, szczegol, score, scorer, criteriaHash: wersja, tender, teraz,
    });
    wynik.odrzucone[przyczyna] = (wynik.odrzucone[przyczyna] ?? 0) + 1;
    await schowaj(tender.id, przyczyna, szczegol);
  };
  const wybierz = async (tender, { score, punkty, scorer, ocenaBezAi, ostateczna }) => {
    const { created, odrzuconyNaWarunkach } = await matches.utworzWybrany({
      userId: user.id, tender, score, punkty, scorer, ocenaBezAi, criteriaHash: wersja, zapiszSlad: ostateczna,
      wersjaFormalnych: wersjaFormalnych(user), teraz,
    });
    if (odrzuconyNaWarunkach) { wynik.odrzucone.warunki++; return; }
    if (!created) return;
    if (plan === 'standard' && !poCzasie() && await odpadaNaWarunkach(user, tender.id, { porownaj, teraz, wersja })) {
      wynik.odrzucone.warunki++;
      return;
    }
    wynik.wybrane++;
    budzetWybranych--;
    wynik.nowe.push(tender.id);
    // Wybrany z BZP: dociągamy listę dokumentów z e-Zamówień (SWZ z linkiem), żeby klient otworzył
    // Radar SWZ bez szukania pliku. Błąd = cicho, przycisk na ekranie dociągnie później.
    if (tender.source === 'bzp' && czyIdPostepowania(tender.postepowanie_id) && !Array.isArray(tender.ez_dokumenty) && budzetDokumentowEz.pozostalo > 0) {
      budzetDokumentowEz.pozostalo--;
      try {
        const dokumenty = await dokumentyEz(tender.postepowanie_id);
        if (Array.isArray(dokumenty)) {
          tender.ez_dokumenty = dokumenty;
          await tenders.zapiszDokumentyEz(tender.id, dokumenty, teraz);
          wynik.dokumentyEz = (wynik.dokumentyEz ?? 0) + 1;
        }
      } catch (err) {
        logger.warn({ err: err.message, id: tender.id }, 'e-Zamówienia: dokumenty po wyborze nie powiodły się');
      }
    }
  };

  for (const { tender, h } of swiezi) {
    const regula = sprawdzReguly(user, tender, teraz);
    if (regula) { await odrzuc(tender, { ...regula, etap: 'regula' }); continue; }

    if (h.score < AI_PREFILTER_MIN) {
      await odrzuc(tender, { przyczyna: 'branza', etap: 'heurystyka', score: h.score, scorer: 'heuristic' });
      continue;
    }
    if (budzetWybranych <= 0) { wynik.oczekuje++; continue; }

    if (!features.ai) {
      // AI wyłączone konfiguracją (brak klucza, emulator) — heurystyka decyduje ostatecznie, jak dotąd.
      if (h.score >= prog) {
        await wybierz(tender, { score: h.score, punkty: punktyZHeurystyki(h), scorer: 'heuristic', ocenaBezAi: true, ostateczna: true });
      } else {
        await odrzuc(tender, { przyczyna: 'branza', etap: 'heurystyka', score: h.score, scorer: 'heuristic' });
      }
      continue;
    }

    // Limit AI wyczerpany albo AI leży (bezpiecznik): kandydat CZEKA. Precyzja przed kompletnością
    // (spec §0) — bez wyboru na samej heurystyce i bez palenia limitu na kolejne nieudane wywołania.
    if (budzetAi <= 0 || stanAi.kolejneBledy >= MAKS_KOLEJNYCH_BLEDOW_AI || poCzasie() || !await aiQuota.reserve(user.id, limitAi)) {
      budzetAi = 0; wynik.oczekuje++; continue;
    }
    budzetAi--;
    wynik.aiCalls++;
    // Kandydat z platformazakupowa.pl: lista nie ma CPV ani wartości — przed oceną dociągamy tryb
    // i wymagania (cache przy ogłoszeniu, budżet żądań na przebieg; błąd = oceniamy bez szczegółu).
    if (tender.source === ZRODLO_PZ && !tender.pz_szczegol && budzetSzczegolowPz.pozostalo > 0) {
      budzetSzczegolowPz.pozostalo--;
      try {
        const sz = await szczegolPz(String(tender.bzp_external_id ?? tender.id).replace(/^pz:/, ''));
        if (sz) {
          tender.pz_szczegol = sz;
          await tenders.zapiszSzczegolPz(tender.id, sz, teraz);
        }
      } catch (err) {
        logger.warn({ err: err.message, id: tender.id }, 'platformazakupowa: szczegół przed oceną nie powiódł się');
      }
    }
    const werdykt = await ocen(user, tender, przyklady, { teraz });
    stanAi.kolejneBledy = werdykt ? 0 : stanAi.kolejneBledy + 1;

    if (!werdykt) {
      // Awaria AI: wybór tymczasowy bez śladu — jutro AI oceni jeszcze raz (spec §4.4).
      if (h.score >= prog) {
        await wybierz(tender, { score: h.score, punkty: punktyZHeurystyki(h), scorer: 'heuristic', ocenaBezAi: true, ostateczna: false });
      } else {
        wynik.oczekuje++;
      }
      continue;
    }

    if (werdykt.decyzja === 'biore' && werdykt.score >= prog) {
      await wybierz(tender, {
        score: werdykt.score, punkty: werdykt.punkty.length ? werdykt.punkty : punktyZHeurystyki(h),
        scorer: 'ai', ocenaBezAi: false, ostateczna: true,
      });
    } else {
      const przyczyna = werdykt.przyczyna ?? 'branza';
      const opis = werdykt.punkty.join(' ');
      await odrzuc(tender, { przyczyna, etap: 'ai', score: werdykt.score, scorer: 'ai', szczegol: opis ? { pl: opis, en: opis } : null });
      await matches.cofnijWyborBezAi(user.id, tender.id, { przyczyna, teraz });
    }
  }

  await dziennik.dopisz(user.id, dobaWarszawska(teraz), {
    przejrzane: wynik.przejrzane, wybrane: wynik.wybrane, oczekuje: wynik.oczekuje,
    odrzucone: wynik.odrzucone, aiWywolan: wynik.aiCalls, teraz,
  });
  await users.oznaczPrzebiegSelekcji(user.id, { o: teraz, wersja });
  return wynik;
}

const ROWNOLEGLE_USEROW = 5;
const BUDZET_CZASU_CYKLU_MS = 440_000;

/**
 * Przebieg dla wszystkich (12:00) albo tylko Standard (co 3 h). Pula czytana RAZ,
 * kolejka od najdawniej obsłużonego, porcje równoległe, budżet czasu — jak w
 * generateMatchesForAllUsers (uzasadnienia tam). Powiadomienie po każdym kliencie.
 */
export async function pracujDlaWszystkich({
  tylkoStandard = false,
  tryb = 'dzienny',
  budzetCzasuMs = BUDZET_CZASU_CYKLU_MS,
  teraz = () => nowIso(),
  wczytajUzytkownikow = () => users.all(),
  wczytajPule = () => tenders.openPool({ swiezaKopia: true }),
  powiadom = powiadomPoPrzebiegu,
} = {}) {
  const start = Date.now();
  const wszyscy = (await wczytajUzytkownikow())
    .filter((u) => !tylkoStandard || planEfektywny(u, teraz()) === 'standard');
  const wynik = { wybrane: 0, aiCalls: 0, obsluzeni: 0, pominieci: 0 };
  if (!wszyscy.length) return wynik;

  const pool = await wczytajPule();
  const stanAi = { kolejneBledy: 0 };
  wszyscy.sort((a, b) => String(a.last_cycle_at ?? '').localeCompare(String(b.last_cycle_at ?? '')));

  for (let i = 0; i < wszyscy.length; i += ROWNOLEGLE_USEROW) {
    if (Date.now() - start > budzetCzasuMs) {
      wynik.pominieci = wszyscy.length - wynik.obsluzeni;
      logger.warn({ ...wynik, tryb }, 'Selekcja przerwana po wyczerpaniu budżetu czasu — pominięci wejdą jako pierwsi');
      break;
    }
    const porcja = wszyscy.slice(i, i + ROWNOLEGLE_USEROW);
    const wyniki = await Promise.all(porcja.map(async (user) => {
      try {
        const w = await pracujDlaUzytkownika(user, pool, { teraz: teraz(), stanAi });
        try {
          await powiadom(await users.findById(user.id) ?? user, { tryb, teraz: teraz() });
        } catch (err) {
          logger.error({ err: err.message, userId: user.id }, 'Powiadomienie po selekcji nie wysłane');
        }
        return w;
      } catch (err) {
        logger.error({ err: err.message, userId: user.id }, 'Selekcja użytkownika nie powiodła się');
        return { wybrane: 0, aiCalls: 0 };
      } finally {
        await users.oznaczCyklObsluzony(user.id).catch(() => {});
      }
    }));
    for (const w of wyniki) { wynik.wybrane += w.wybrane; wynik.aiCalls += w.aiCalls; }
    wynik.obsluzeni += porcja.length;
  }
  logger.info({ ...wynik, tryb, uzytkownikow: wszyscy.length, pula: pool.length, durationMs: Date.now() - start },
    'Selekcja zakończona');
  return wynik;
}

/**
 * Ponowna ocena po zmianie karty/profilu, rejestracji albo z panelu admina.
 * Kształt wyniku jak `backfillUser` — wołający się nie zmieniają.
 */
export async function przeliczProfil(user, { wymus = false, budzetMs = BUDZET_PRZELICZENIA_MS } = {}) {
  if (env.PRACOWNIK_ENABLED !== 'true') return backfillUser(user, { wymus });
  if (!wymus && !await backfillCooldown.reserve(user.id)) {
    logger.info({ userId: user.id }, 'Przeliczenie pominięte — poprzedni przebieg był niedawno');
    return { created: 0, evaluated: 0, aiCalls: 0, pominiety: true };
  }
  const w = await pracujDlaUzytkownika(user, await tenders.openPool(), { budzetMs });
  return { created: w.wybrane, evaluated: w.przejrzane, aiCalls: w.aiCalls };
}

/** Cykl 12:00 (jobs/fetchTenders.js): selekcja albo stary silnik — wg przełącznika. */
export async function cyklDzienny({ budzetCzasuMs } = {}) {
  if (env.PRACOWNIK_ENABLED !== 'true') return generateMatchesForAllUsers({ budzetCzasuMs });
  return (await pracujDlaWszystkich({ tryb: 'dzienny', budzetCzasuMs })).wybrane;
}
