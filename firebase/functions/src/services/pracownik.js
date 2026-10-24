import { env, features } from '../config.js';
import { nowIso } from '../lib/ids.js';
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
import { users, tenders, matches, evaluations, aiQuota, dziennik, warunkiQuota } from '../db/repos.js';
import { ocenDlaKlienta, porownajWarunki } from './ai.js';

/*
 * Selekcja przetargów pod klienta (plans/PRACOWNIK-PROJEKT-2026-10-23.md §4).
 *
 * Lejek: sygnał tematyczny (heurystyka) → twarde reguły karty (bez kosztu, odrzucenie
 * z przyczyną) → ranking → AI z kartą firmy i przykładami dla czołówki. Bezpieczniki
 * kosztowe te same co w services/matching.js. Każda decyzja ostateczna zostawia ślad
 * w `evaluations` przypięty do WERSJI KARTY — zmiana karty = przegląd od nowa.
 */
export const LIMIT_WARUNKOW_DZIENNIE = 20;

function punktyZHeurystyki(h) {
  const punkty = [];
  if (h.matchedKeywords.length) punkty.push(`Tytuł trafia w Twoje słowa: ${h.matchedKeywords.join(', ')}.`);
  if (h.cpvMatched) punkty.push('Kod CPV zgodny z Twoim profilem.');
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
 * @param {{teraz?: string, ocen?: Function, porownaj?: Function}} [opcje] AI wstrzykiwane w testach
 */
export async function pracujDlaUzytkownika(user, pool, { teraz = nowIso(), ocen = ocenDlaKlienta, porownaj = porownajWarunki } = {}) {
  const wynik = { przejrzane: 0, wybrane: 0, oczekuje: 0, odrzucone: pustyLicznikPrzyczyn(), aiCalls: 0, nowe: [] };
  if (!user.keywords?.length && !user.cpv_codes?.length) return wynik;

  const plan = planEfektywny(user, teraz);
  const wersja = wersjaKarty(user);
  const pelnyPrzeglad = !user.pracownik_ostatni_przebieg || user.pracownik_wersja !== wersja;
  const czyNowy = (t) => pelnyPrzeglad || String(t.fetched_at ?? '') > user.pracownik_ostatni_przebieg;

  let budzetWybranych = plan === 'free'
    ? Math.max(0, env.FREE_TIER_DAILY_MATCH_LIMIT - await matches.countToday(user.id))
    : Infinity;

  const ranked = [];
  for (const tender of pool) {
    const nowy = czyNowy(tender);
    if (nowy) wynik.przejrzane++;
    const h = heuristicScore(user, tender);
    if (h.score > 0) ranked.push({ tender, h });
    else if (nowy) wynik.odrzucone.branza++;
  }
  ranked.sort((a, b) => b.h.score - a.h.score);

  // Świeży = bez decyzji przy tej wersji karty. Oknami — jak w services/matching.js.
  const swiezi = [];
  for (let start = 0; start < ranked.length && swiezi.length < CANDIDATE_HEAD; start += OKNO_KANDYDATOW) {
    const okno = ranked.slice(start, start + OKNO_KANDYDATOW);
    const ocenione = await evaluations.idsAmong(user.id, okno.map((x) => x.tender.id), wersja);
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
  };
  const wybierz = async (tender, { score, punkty, scorer, ocenaBezAi, ostateczna }) => {
    const { created } = await matches.utworzWybrany({
      userId: user.id, tender, score, punkty, scorer, ocenaBezAi, criteriaHash: wersja, zapiszSlad: ostateczna, teraz,
    });
    if (!created) return;
    if (plan === 'standard' && await odpadaNaWarunkach(user, tender.id, { porownaj, teraz, wersja })) {
      wynik.odrzucone.warunki++;
      return;
    }
    wynik.wybrane++;
    budzetWybranych--;
    wynik.nowe.push(tender.id);
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

    // Limit AI wyczerpany: kandydat CZEKA. Precyzja przed kompletnością (spec §0) — bez wyboru na samej heurystyce.
    if (budzetAi <= 0 || !await aiQuota.reserve(user.id, limitAi)) { budzetAi = 0; wynik.oczekuje++; continue; }
    budzetAi--;
    wynik.aiCalls++;
    const werdykt = await ocen(user, tender, przyklady, { teraz });

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
