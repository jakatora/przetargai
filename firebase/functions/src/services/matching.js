import { createHash } from 'node:crypto';
import { env, features } from '../config.js';
import { logger } from '../lib/logger.js';
import { heuristicScore } from '../lib/scoring.js';
import { users, tenders, matches, evaluations, aiQuota, backfillCooldown } from '../db/repos.js';
import { scoreTenderMatch } from './ai.js';
import { sendPush } from './push.js';

/*
 * Silnik dopasowań na Firestore (port z Railway + naprawy z audytu 2026-07-09).
 *
 * Kolejność: darmowa heurystyka rankuje CAŁĄ pulę → płatne AI ocenia wyłącznie
 * czołówkę → wynik ≥ progu tworzy dopasowanie. Każda ocena (także odrzucająca)
 * zostawia ślad w `evaluations`, więc odrzucony kandydat nie wraca jutro do AI.
 *
 * Trzy bezpieczniki kosztowe, każdy z innego powodu:
 *  1. AI_RERANK_TOP_N — ile wywołań AI na JEDEN przebieg (koszt przebiegu),
 *  2. aiQuota — ile wywołań AI na DOBĘ na użytkownika (denial-of-wallet),
 *  3. aiBudgetAllows w services/ai.js — wspólny miesięczny limit (koszt globalny).
 */

/** Poniżej tego wyniku heurystycznego nie wołamy AI (kontrola kosztów). */
const AI_PREFILTER_MIN = 15;

/** Dobowy limit płatnych wywołań AI na użytkownika, wg planu. */
const AI_CALLS_PER_DAY = { free: 10, standard: 120 };

/** Ilu ŚWIEŻYCH (jeszcze nieocenionych) kandydatów zbieramy na jeden przebieg. */
const CANDIDATE_HEAD = 120;

/** Ilu kandydatów sprawdzamy jednym `getAll` przy szukaniu świeżych. */
const OKNO_KANDYDATOW = 150;

/**
 * Górna granica przeglądania rankingu. Bez niej użytkownik z bardzo szerokim
 * profilem i tysiącami ocenionych przetargów kazałby nam czytać całą pulę.
 */
const MAKS_PRZEJRZANYCH = 600;

/** Odcisk kryteriów profilu — zmiana słów/CPV unieważnia stare oceny. */
export function criteriaHash(user) {
  const kryteria = JSON.stringify({
    keywords: [...(user.keywords ?? [])].sort(),
    cpv: [...(user.cpv_codes ?? [])].sort(),
  });
  return createHash('sha256').update(kryteria).digest('hex').slice(0, 12);
}

function heuristicReasoning(h) {
  const parts = [];
  if (h.matchedKeywords.length) parts.push(`Trafione słowa kluczowe: ${h.matchedKeywords.join(', ')}.`);
  if (h.cpvMatched) parts.push('Zgodność kodu CPV z profilem firmy.');
  return parts.join(' ') || 'Brak wyraźnych trafień w profilu firmy.';
}

/**
 * Dopasowuje użytkownika do puli przetargów.
 * @param {object} user
 * @param {object[]} pool przetargi z otwartym terminem (pobrane RAZ dla wszystkich userów)
 * @returns {Promise<{created: number, evaluated: number, aiCalls: number}>}
 */
export async function generateMatchesForUser(user, pool) {
  if (!user.keywords?.length && !user.cpv_codes?.length) return { created: 0, evaluated: 0, aiCalls: 0 };

  const isFree = user.premium_tier === 'free';
  let dailyBudget = isFree
    ? Math.max(0, env.FREE_TIER_DAILY_MATCH_LIMIT - await matches.countToday(user.id))
    : Infinity;
  if (dailyBudget <= 0) return { created: 0, evaluated: 0, aiCalls: 0 };

  // Ranking darmową heurystyką. Kandydat bez ŻADNEGO sygnału nie ma po co żyć.
  const ranked = pool
    .map((tender) => ({ tender, heuristic: heuristicScore(user, tender) }))
    .filter((x) => x.heuristic.score > 0)
    .sort((a, b) => b.heuristic.score - a.heuristic.score);

  if (!ranked.length) return { created: 0, evaluated: 0, aiCalls: 0 };

  /*
   * Zbieramy ŚWIEŻYCH kandydatów, przeglądając ranking oknami.
   *
   * Audyt 2026-07-10: ranking był obcinany do `CANDIDATE_HEAD` PRZED odsianiem
   * ocenionych. Użytkownik z szerokim profilem, którego czołowa setka została już
   * oceniona, nie dostawał NIC — i tak każdego dnia, bo do 121. kandydata ranking
   * nigdy nie sięgał. Teraz idziemy dalej, aż uzbieramy komplet świeżych albo
   * wyczerpiemy ranking. Sprawdzenie kosztuje jeden `getAll` na okno.
   */
  const hash = criteriaHash(user);
  const swiezi = [];
  for (let start = 0; start < ranked.length && swiezi.length < CANDIDATE_HEAD; start += OKNO_KANDYDATOW) {
    const okno = ranked.slice(start, start + OKNO_KANDYDATOW);
    const juzOcenione = await evaluations.idsAmong(user.id, okno.map((x) => x.tender.id), hash);
    for (const kandydat of okno) {
      if (!juzOcenione.has(kandydat.tender.id)) swiezi.push(kandydat);
    }
    // Bezpiecznik kosztowy: nie przeglądamy całej puli w nieskończoność.
    if (start + OKNO_KANDYDATOW >= MAKS_PRZEJRZANYCH) break;
  }

  /*
   * Limit wywołań AI na ten przebieg = mniejsze z: limitu przebiegu i tego, co
   * ZOSTAŁO z dobowej kwoty użytkownika. Odczytujemy kwotę RAZ. Wcześniej
   * `aiQuota.reserve` biegło dla każdego kandydata z osobna — także po wyczerpaniu
   * limitu — czyli transakcja Firestore (odczyt + zapis) na każdego z ~120
   * kandydatów, żeby za każdym razem usłyszeć „nie" (audyt 2026-07-10).
   */
  const limitDobowy = AI_CALLS_PER_DAY[user.premium_tier] ?? AI_CALLS_PER_DAY.free;
  const zuzytoDzis = features.ai ? await aiQuota.used(user.id) : limitDobowy;
  let aiBudget = Math.min(env.AI_RERANK_TOP_N, Math.max(0, limitDobowy - zuzytoDzis));

  let created = 0;
  let evaluated = 0;
  let aiCalls = 0;
  const fresh = [];

  for (const { tender, heuristic } of swiezi) {
    if (dailyBudget <= 0) break;
    // Nie sprawdzamy `matches.exists` — to był odczyt na KAŻDEGO kandydata.
    // Kandydaci z dopasowaniem mają już ślad w `evaluations` (zapis atomowy),
    // więc odsiał ich `idsAmong` powyżej. Ostatnią barierą jest `create()`,
    // które i tak odrzuci duplikat.

    evaluated++;
    let score = heuristic.score;
    let reasoning = heuristicReasoning(heuristic);
    let scorer = 'heuristic';

    // AI tylko dla sensownych kandydatów i tylko w granicach WSZYSTKICH trzech limitów.
    const wartoPytacAi = features.ai && heuristic.score >= AI_PREFILTER_MIN && aiBudget > 0;
    let aiOdpowiedzialo = false;
    if (wartoPytacAi && await aiQuota.reserve(user.id, limitDobowy)) {
      // Budżet przebiegu maleje przy PRÓBIE, nie przy sukcesie: nieudane wywołanie
      // (timeout, błąd parsowania) też kosztuje pieniądze i czas.
      aiBudget--;
      aiCalls++;
      const ai = await scoreTenderMatch(user, tender);
      if (ai) {
        score = ai.score;
        reasoning = ai.reasoning || reasoning;
        scorer = 'ai';
        aiOdpowiedzialo = true;
      }
    }

    /*
     * Kiedy ocena jest OSTATECZNA (wolno zostawić ślad, który zamknie kandydatowi
     * drogę powrotną)? Audyt 2026-07-10: ślad zapisywaliśmy zawsze, więc przetarg
     * oceniony heurystycznie w dniu awarii AI (albo po wyczerpaniu limitu wywołań)
     * NIGDY już nie trafiał do modelu — jednorazowa usterka trwale psuła jakość feedu.
     */
    const ocenaOstateczna = aiOdpowiedzialo || !wartoPytacAi;

    if (score < env.MATCH_CONFIDENCE_THRESHOLD) {
      if (ocenaOstateczna) {
        await evaluations.record(user.id, tender.id, { score, scorer, criteriaHash: hash });
      }
      continue;
    }

    // Dopasowanie i ślad zapisujemy JEDNYM batchem. Rozdzielone groziły albo utratą
    // kwalifikującego się przetargu (ślad bez dopasowania), albo ponowną opłatą za AI
    // nazajutrz (dopasowanie bez śladu).
    const { created: ok, match } = await matches.createWithEvaluation({
      userId: user.id, tenderId: tender.id, score, reasoning, scorer, tender, criteriaHash: hash,
    });
    if (ok) {
      created++;
      dailyBudget--;
      fresh.push({ id: match.id, title: tender.title });
    }
  }

  if (user.premium_tier === 'standard' && user.push_token && fresh.length) {
    await sendPush(user.push_token, {
      title: 'Nowe dopasowane przetargi',
      body: fresh.length === 1
        ? fresh[0].title
        : `${fresh.length} nowych przetargów dopasowanych do Twojej firmy`,
      data: { type: 'new_matches', count: fresh.length },
    });
    for (const m of fresh) await matches.markNotified(user.id, m.id);
  }

  return { created, evaluated, aiCalls };
}

/**
 * Dopasowuje usera do istniejących, otwartych przetargów (rejestracja / zmiana profilu).
 *
 * Hamulec czasowy: pełny przebieg jest kosztowny (odczyt puli + oceny), a użytkownik
 * może zmieniać kryteria wielokrotnie pod rząd. Bez odstępu jedno konto, przełączając
 * słowa kluczowe, potrafiło wygenerować setki tysięcy odczytów Firestore na minutę
 * (audyt 2026-07-10). Odmowa nie gubi zmiany — nocny cron i tak dopasuje profil.
 *
 * @param {{wymus?: boolean}} [opts] `wymus: true` pomija hamulec (rejestracja, admin)
 */
export async function backfillUser(user, { wymus = false } = {}) {
  if (!wymus && !await backfillCooldown.reserve(user.id)) {
    logger.info({ userId: user.id }, 'Backfill pominięty — poprzedni przebieg był niedawno');
    return { created: 0, evaluated: 0, aiCalls: 0, pominiety: true };
  }
  const pool = await tenders.openPool();
  return generateMatchesForUser(user, pool);
}

/** Ilu użytkowników przetwarzamy równolegle w cyklu dziennym. */
const RÓWNOLEGLE_USEROW = 5;

/**
 * Ile milisekund cyklu wolno zużyć, zanim zaczniemy zamykać robotę.
 *
 * Funkcja `dailyTenderFetch` ma twardy limit 540 s (zdarzeniowe funkcje 2. generacji),
 * po którym platforma ją ZABIJA w połowie pętli. Audyt 2026-07-10: cykl wołał AI
 * sekwencyjnie (jedno wywołanie Haiku ≈ 1–2 s), więc już przy kilkudziesięciu kontach
 * kończył się egzekucją, a użytkownicy z końca listy po cichu nie dostawali nic —
 * bez błędu, bez ponowienia. Zostawiamy zapas na zamknięcie i raport.
 */
const BUDŻET_CZASU_CYKLU_MS = 440_000;

/**
 * Cykl dzienny. Pula pobierana RAZ dla wszystkich userów — przy 100 kontach
 * to jeden odczyt puli zamiast stu (Firestore liczy każdy dokument osobno).
 *
 * Użytkownicy są przetwarzani porcjami równolegle i w kolejności OD NAJDAWNIEJ
 * obsłużonego, więc gdy zabraknie czasu, następny przebieg zacznie od pominiętych.
 * Bez tego ci sami użytkownicy z końca alfabetu byliby głodzeni każdego dnia.
 */
export async function generateMatchesForAllUsers({ budzetCzasuMs = BUDŻET_CZASU_CYKLU_MS } = {}) {
  const start = Date.now();
  // Cron liczy na ŚWIEŻEJ puli — cache w pamięci instancji pomijamy jawnie.
  const pool = await tenders.openPool(2000, { swiezaKopia: true });
  const wszyscy = await users.all();

  // Najpierw ci, którzy najdłużej czekali (brak znacznika = nigdy nie obsłużeni).
  wszyscy.sort((a, b) => String(a.last_cycle_at ?? '').localeCompare(String(b.last_cycle_at ?? '')));

  let total = 0;
  let aiCalls = 0;
  let obsluzeni = 0;
  let pominieci = 0;

  for (let i = 0; i < wszyscy.length; i += RÓWNOLEGLE_USEROW) {
    if (Date.now() - start > budzetCzasuMs) {
      pominieci = wszyscy.length - obsluzeni;
      logger.warn({ obsluzeni, pominieci },
        'Cykl dopasowań przerwany po wyczerpaniu budżetu czasu — pominięci wejdą jako pierwsi następnym razem');
      break;
    }

    const porcja = wszyscy.slice(i, i + RÓWNOLEGLE_USEROW);
    const wyniki = await Promise.all(porcja.map(async (user) => {
      try {
        return await generateMatchesForUser(user, pool);
      } catch (err) {
        // Awaria jednego usera nie może zatrzymać cyklu dla pozostałych.
        logger.error({ err: err.message, userId: user.id }, 'Dopasowania użytkownika nie powiodły się');
        return { created: 0, aiCalls: 0 };
      } finally {
        /*
         * Znacznik stawiamy TAKŻE po błędzie. Wcześniej tylko po sukcesie, więc
         * użytkownik, którego dopasowania stale się wywracają (np. uszkodzony profil),
         * na zawsze zostawał na początku kolejki i **codziennie blokował** miejsce
         * innym, zjadając budżet czasu cyklu (audyt 2026-07-10). Błąd trafia do
         * Error Reporting; kolejka ma być sprawiedliwa, nie pamiętliwa.
         */
        await users.oznaczCyklObsluzony(user.id).catch(() => {});
      }
    }));

    for (const r of wyniki) { total += r.created; aiCalls += r.aiCalls; }
    obsluzeni += porcja.length;
  }

  logger.info({ users: wszyscy.length, obsluzeni, pominieci, pool: pool.length, matchesCreated: total, aiCalls, durationMs: Date.now() - start },
    'Cykl dopasowań zakończony');
  return total;
}
