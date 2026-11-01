import { Router } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ah } from '../lib/asyncHandler.js';
import { adminRequired } from '../middleware/adminAuth.js';
import { runTenderFetch } from '../jobs/fetchTenders.js';
import { runBkOkno } from '../jobs/oknoBk.js';
import { runOknoWynikow } from '../jobs/oknoWynikow.js';
import { runBenchmarkRynku } from '../jobs/benchmarkRynku.js';
import { runOknoPlanow } from '../jobs/oknoPlanow.js';
import { runWynikiAggregation } from '../jobs/aggregateResults.js';
import { pobierzOgloszeniaBzp, pobierzSuroweWynikiDnia } from '../services/bzp.js';
import { pobierzOgloszeniaTedDnia } from '../services/ted.js';
import { pobierzSzczegol as pobierzSzczegolPz } from '../services/platformaZakupowa.js';
import { kryteriaZSwzPz } from '../services/kryteriaSwzPz.js';
import { pobierzSzczegolBk, normalizujOgloszenieBk, TEMPO_BK } from '../services/bazaKonkurencyjnosci.js';
import { stanTempa } from '../lib/tempoZapytan.js';
import { parsujWynik } from '../lib/wynikiParser.js';
import { runUmowyWygasajace } from '../jobs/umowyWygasajace.js';
import { przeliczProfil } from '../services/pracownik.js';
import { tenders, users, rozstrzygniecia, matches as dopasowania } from '../db/repos.js';
import { budgetStatus } from '../services/ai.js';
import { badRequest, notFound, serviceUnavailable } from '../lib/errors.js';

const router = Router();
router.use(adminRequired);

/**
 * Ręczne uruchomienie pełnego cyklu: pobranie przetargów (dzień po dniu, z docinaniem
 * po województwach — patrz services/bzp.js) + matching. `pageSize` USUNIĘTY: od naprawy
 * paginacji (2026-07-17) rozmiar okna nie jest już decyzją wołającego.
 */
router.post('/fetch-tenders', ah(async (req, res) => {
  const result = await runTenderFetch();
  res.json(result);
}));

/**
 * Ręczne domknięcie okna Bazy Konkurencyjności — BEZ dopasowań i BEZ AI.
 *
 * DLACZEGO OSOBNO OD `/fetch-tenders`: tamten uruchamia pełny cykl razem z
 * dopasowaniami, czyli PŁATNE wywołania Claude. Operator, który chce tylko
 * sprawdzić, czy import ze źródła działa (albo domknąć zaległość po awarii),
 * nie powinien za to płacić. Ten przebieg kosztuje wyłącznie odczyty publicznego
 * API BK i zapisy do Firestore.
 *
 * Idempotentny: docId przetargu = `bk:<id>`, a checkpoint pilnuje, żeby szczegóły
 * pobierały się tylko dla ogłoszeń nowych i zmienionych.
 */
router.post('/okno-bk', ah(async (req, res) => {
  const wynik = await runBkOkno();
  res.status(wynik.ok ? 200 : 503).json(wynik);
}));

/**
 * Ręczne domknięcie okna ROZSTRZYGNIĘĆ (etap 6) — BEZ dopasowań i BEZ AI.
 *
 * Ta sama zasada, co przy `/okno-bk`: operator ma móc domknąć zaległość albo
 * sprawdzić źródło, nie płacąc za wywołania modelu. Koszt to odczyty publicznych
 * API BZP i TED oraz zapisy do Firestore.
 *
 * Idempotentny: docId rozstrzygnięcia = identyfikator ogłoszenia o wyniku.
 */
/*
 * 🚨 BUDŻET: ten przebieg biegnie w funkcji `api`, która ma 300 s (harmonogramowy
 * `wynikiOknoFetch` ma 1800 s). Bez własnego, krótszego budżetu platforma ubiłaby
 * żądanie w połowie i checkpoint — zapisywany na końcu przebiegu — nie zanotowałby
 * ŻADNEJ domkniętej doby. Dane rozstrzygnięć zapisują się co dobę, więc nic by nie
 * przepadło, ale operator wołałby w kółko te same dni. 240 s zostawia zapas na
 * zapis checkpointu i odpowiedź.
 */
const BUDZET_WYZWALACZA_MS = 240_000;

router.post('/okno-wynikow', ah(async (req, res) => {
  const { dniBzp, dniTed, budzetMs } = req.body ?? {};
  const wynik = await runOknoWynikow({
    ...(Number.isFinite(dniBzp) ? { dniBzp } : {}),
    ...(Number.isFinite(dniTed) ? { dniTed } : {}),
    budzetMs: Number.isFinite(budzetMs) ? budzetMs : BUDZET_WYZWALACZA_MS,
  });
  res.status(wynik.ok ? 200 : 503).json(wynik);
}));

/**
 * Ręczny import planów postępowań z TED (Radar planów) — BEZ dopasowań i BEZ AI.
 *
 * `dni` pozwala zrobić pierwsze zasilenie: WOI obowiązuje do 12 miesięcy, więc
 * roczny import (`dni: 365`, ~2 500 ogłoszeń, kilkanaście zapytań) wypełnia radar
 * od razu, zamiast czekać rok na harmonogram. Idempotentny: docId = numer publikacji.
 */
router.post('/okno-planow', ah(async (req, res) => {
  const dni = Number(req.body?.dni);
  const wynik = await runOknoPlanow(Number.isInteger(dni) && dni >= 1 && dni <= 400 ? { dni } : {});
  res.status(wynik.ok ? 200 : 503).json(wynik);
}));

/**
 * Ręczne przeliczenie benchmarku rynku z ZAPISANYCH rozstrzygnięć (etap 6).
 *
 * Nie dotyka rejestrów zewnętrznych — liczy od nowa z tego, co już w bazie.
 * To jest właściwa reakcja na poprawkę parsera albo zmianę progów próbki.
 */
/**
 * Uzupełnienie listy kryteriów oceny (2026-10-31) w przetargach BZP zapisanych przed tą zmianą.
 * Dzienne pobieranie samo dopisuje ją ostatnim `BZP_LOOKBACK_DAYS` dobom (upsert uzupełnia raz),
 * a ta trasa sięga dalej: JEDNA doba publikacji na wywołanie, BEZ dopasowań i BEZ AI — kosztuje
 * tylko odczyt publicznego API BZP i zapis brakujących pól.
 */
router.post('/kryteria-wstecz', ah(async (req, res) => {
  const dzien = String(req.body?.dzien ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dzien) || Number.isNaN(Date.parse(dzien))) throw badRequest('Podaj dzien w formacie RRRR-MM-DD');
  const ogloszenia = await pobierzOgloszeniaBzp({ from: dzien, to: dzien });
  const wynik = await tenders.uzupelnijKryteria(ogloszenia);
  res.json({ dzien, pobrane: ogloszenia.length, ...wynik });
}));

/**
 * Kryteria oceny dla zapisanych przetargów TED (2026-11-01) — jak `/kryteria-wstecz` dla BZP: tylko
 * tam, gdzie listy jeszcze nie ma, bez tworzenia dokumentów. Doba TED to ~6 s, a limiter admina
 * wpuszcza 20 wywołań na 15 min — dlatego zakres `od`…`do` (do 20 dób, od nowszej) w jednym wywołaniu.
 */
const MAKS_DOB_TED = 20;
router.post('/kryteria-ted-wstecz', ah(async (req, res) => {
  const dataOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const od = String(req.body?.od ?? req.body?.dzien ?? '');
  const doDnia = String(req.body?.do ?? req.body?.dzien ?? '');
  if (!dataOk(od) || !dataOk(doDnia) || doDnia > od) throw badRequest('Podaj od i do (RRRR-MM-DD, od >= do) albo dzien');
  const doby = [];
  for (let t = Date.parse(od); t >= Date.parse(doDnia) && doby.length < MAKS_DOB_TED; t -= 86_400_000) doby.push(new Date(t).toISOString().slice(0, 10));
  const razem = { pobrane: 0, z_kryteriami: 0, istniejace: 0, uzupelnione: 0 };
  const dni = [];
  for (const dzien of doby) {
    const ogloszenia = await pobierzOgloszeniaTedDnia(dzien);
    const wynik = await tenders.uzupelnijKryteria(ogloszenia);
    dni.push({ dzien, pobrane: ogloszenia.length, ...wynik });
    razem.pobrane += ogloszenia.length;
    for (const k of ['z_kryteriami', 'istniejace', 'uzupelnione']) razem[k] += wynik[k];
  }
  res.json({ od, do: doby.at(-1), ...razem, dni });
}));

/**
 * Kryteria oceny dla wskazanych przetargów z platformazakupowa.pl (2026-11-01): szczegół z tabelą
 * „Kryteria i warunki formalne” pobrany od nowa i zapisany razem z polami kryteriów. Do 15 na
 * wywołanie — platforma wymaga cichego SSO na każde ogłoszenie (~2 s).
 */
/**
 * Kryteria oceny dla wskazanych przetargów z Bazy Konkurencyjności (2026-11-01): szczegół z API BK
 * (z jego własnym tempem zapytań) → `uzupelnijKryteria`, tylko tam, gdzie listy nie ma. Do 30 na wywołanie.
 */
router.post('/kryteria-bk', ah(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean).slice(0, 30);
  if (!ids.length) throw badRequest('Podaj ids (do 30)');
  const ogloszenia = [];
  const przykladyBledow = [];
  // Wspólne tempo dla całej partii (400 ms odstępu, przerwa po 403) — jak w oknie BK.
  const tempo = stanTempa(TEMPO_BK);
  for (const id of ids) {
    try {
      const t = normalizujOgloszenieBk(await pobierzSzczegolBk(String(id).replace(/^bk[:_]/, ''), { tempo }));
      if (t) ogloszenia.push(t);
    } catch (err) {
      if (przykladyBledow.length < 3) przykladyBledow.push(`${id}: ${String(err.message).slice(0, 160)}`);
    }
  }
  res.json({ pobrane: ogloszenia.length, ...(await tenders.uzupelnijKryteria(ogloszenia)), przyklady_bledow: przykladyBledow });
}));

const ODSTEP_PZ_MS = 3000;
router.post('/kryteria-pz', ah(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean).slice(0, 15);
  if (!ids.length) throw badRequest('Podaj ids (do 15)');
  const wynik = { sprawdzone: 0, z_kryteriami: 0, bledy: 0, przyklady_bledow: [] };
  // `szczegol_zapisany`: szczegół świeżo pobrany (bez kryteriów w tabeli) — sam bliźniak z BZP/TED, bez platformy.
  const bezPlatformy = req.body?.szczegol_zapisany === true;
  for (const id of ids) {
    const t = await tenders.findById(id);
    if (!t || t.source !== 'platformazakupowa') continue;
    wynik.sprawdzone += 1;
    try {
      // `z_swz`: brak w tabeli i u bliźniaka → kryteria z treści SWZ (PDF z platformy, bez AI).
      const opcje = req.body?.z_swz === true ? { zSwz: kryteriaZSwzPz } : {};
      const pola = bezPlatformy && t.pz_szczegol
        ? await tenders.zapiszSzczegolPz(t.id, t.pz_szczegol, t.pz_szczegol_o, opcje)
        : await tenders.zapiszSzczegolPz(t.id, await pobierzSzczegolPz(String(t.bzp_external_id ?? t.id).replace(/^pz:/, '')), undefined, opcje);
      if (pola.kryteria) wynik.z_kryteriami += 1;
      if (bezPlatformy && !opcje.zSwz) continue;
    } catch (err) {
      wynik.bledy += 1;
      if (wynik.przyklady_bledow.length < 3) wynik.przyklady_bledow.push(`${id}: ${String(err.message).slice(0, 160)}`);
    }
    // Platforma zaczęła odmawiać po ~20 szczegółach pod rząd (1.11) — odstęp między ogłoszeniami.
    await new Promise((r) => { setTimeout(r, ODSTEP_PZ_MS); });
  }
  res.json(wynik);
}));

/**
 * Ponowny odczyt wyników BZP z jednej doby (2026-10-31): rozstrzygnięcia zapisane przed odczytem
 * okresu umowy (8.3) nie mają `koniecUmowy`, więc radar wygasających umów ich nie widzi. Nadpisuje
 * dokumenty świeżym parsowaniem (te same dane + okres), bez checkpointu okna i bez AI.
 */
router.post('/wyniki-ponow-dzien', ah(async (req, res) => {
  const dzien = String(req.body?.dzien ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dzien) || Number.isNaN(Date.parse(dzien))) throw badRequest('Podaj dzien w formacie RRRR-MM-DD');
  const surowe = await pobierzSuroweWynikiDnia(dzien);
  const wyniki = surowe.map(parsujWynik).filter((w) => w?.externalId);
  const { zapisane, czesci } = await rozstrzygniecia.zapiszWiele(wyniki);
  const zKoncem = wyniki.filter((w) => w.czesci.some((c) => c.koniecUmowy)).length;
  res.json({ dzien, pobrane: surowe.length, zapisane, czesci, z_koncem_umowy: zKoncem });
}));

/**
 * Skrót kryteriów („Cena 60% · Gwarancja 40%”) w kopiach przetargów, które już są w feedach
 * i Zapisanych (2026-10-31). Nowe dopasowania dostają go przy tworzeniu. Bez BZP i bez AI.
 */
router.post('/kryteria-skrot-kopii', ah(async (req, res) => {
  res.json(await dopasowania.uzupelnijSkrotKryteriow());
}));

/** Ręczne przeliczenie radaru wygasających umów (normalnie job o 4:20). */
router.post('/umowy-wygasajace', ah(async (req, res) => {
  const wynik = await runUmowyWygasajace();
  res.status(wynik.ok ? 200 : 503).json(wynik);
}));

/** Monitoring nowych dokumentów w Zapisanych i czołówce feedu (2026-11-01) — ręczny przebieg, jak co 2 h. */
router.post('/monitor-dokumentow', ah(async (req, res) => {
  const { runMonitorDokumentow } = await import('../jobs/monitorDokumentow.js');
  const wynik = await runMonitorDokumentow();
  res.status(wynik.ok ? 200 : 503).json(wynik);
}));

/** Ręczny przebieg odczytu informacji z otwarcia ofert dla rynku (2026-11-01); `limit` ≤ 500. */
router.post('/otwarcie-rynku', ah(async (req, res) => {
  const { runOtwarcieRynku } = await import('../jobs/otwarcieRynku.js');
  const limit = Math.min(500, Math.max(1, Number(req.body?.limit) || 220));
  const wynik = await runOtwarcieRynku({ limit, budzetMs: 240_000 });
  res.status(wynik.ok ? 200 : 503).json(wynik);
}));

router.post('/benchmark', ah(async (req, res) => {
  const wynik = await runBenchmarkRynku();
  res.json(wynik);
}));

/**
 * Ręczne przeliczenie STATYSTYK WYNIKÓW (`wyniki_stats`) — tych, które karmią
 * `GET /matches/:id/wyniki`.
 *
 * 🚨 Po co osobny wyzwalacz, skoro jest cron: `aggregateResults` chodzi RAZ
 * W TYGODNIU (niedziela 4:00). Gdy naprawia się to, co ten job liczy — a etap 6
 * naprawił samo pobieranie wyników z BZP, martwe od rundy 16 — czekanie do
 * niedzieli znaczy „nie wiem, czy naprawa działa". Operator ma móc to sprawdzić
 * od razu, a po naprawie parsera przeliczyć bez ruszania rejestru.
 *
 * Bez płatnego AI: job liczy z zapisanych rozstrzygnięć, a po rejestr sięga tylko
 * wtedy, gdy w bazie jest ich za mało.
 */
router.post('/agreguj-wyniki', ah(async (req, res) => {
  const { dni } = req.body ?? {};
  const wynik = await runWynikiAggregation(Number.isFinite(dni) ? { dni } : {});
  res.json(wynik);
}));

/** Podstawowe statystyki systemu. */
router.get('/stats', ah(async (req, res) => {
  const [allUsers, tenderCount, aiBudget] = await Promise.all([
    users.all(),
    tenders.count(),
    budgetStatus({ swiezy: true }),
  ]);
  res.json({
    users: allUsers.length,
    tenders: tenderCount,
    ai_budget: aiBudget,
  });
}));

/** Stan budżetu AI (limit miękki / twardy). */
router.get('/ai-budget', ah(async (req, res) => {
  res.json(await budgetStatus({ swiezy: true }));
}));

/**
 * Ręczna kopia zapasowa — NIE dotyczy Firestore.
 * Na Railway był to VACUUM INTO bazy SQLite + szyfrowanie + wysyłka do Backblaze B2.
 * Firestore jest zarządzany: kopie robi platforma (PITR / zaplanowane eksporty do GCS),
 * a zmienne BACKUP_ i B2_ zniknęły z konfiguracji (D-024). Endpoint zostaje w API,
 * ale świadomie zgłasza, że ręczny backup aplikacyjny nie ma tu zastosowania.
 */
router.post('/backup', ah(async () => {
  throw serviceUnavailable('Kopie zapasowe są zarządzane przez Firestore/Google Cloud (PITR / eksporty GCS) — ręczny backup aplikacyjny nie dotyczy tej platformy.');
}));

/** Ostatni zarejestrowani userzy — diagnostyka (czy profile sensowne). */
router.get('/users', ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  // Firestore trzyma keywords/cpv_codes jako natywne tablice (nie JSON string).
  // Rzutujemy JAWNIE wybrane pola — bez tego wyciekłby password_hash i identyfikatory Stripe.
  const rows = (await users.all())
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
    .map((u) => ({
      id: u.id,
      email: u.email,
      company_name: u.company_name,
      company_nip: u.company_nip,
      premium_tier: u.premium_tier,
      keywords: u.keywords ?? [],
      cpv_codes: u.cpv_codes ?? [],
      created_at: u.created_at,
      has_push_token: Boolean(u.push_token),
    }));
  res.json({ count: rows.length, users: rows });
}));

/** Backfill — matching usera vs pula kandydatów (otwarty termin, bez dopasowania). */
router.post('/match-user/:userId', ah(async (req, res) => {
  const user = await users.findById(req.params.userId);
  if (!user) throw notFound('Użytkownik nie istnieje');
  const result = await przeliczProfil(user, { wymus: true });
  res.json({
    ok: true,
    user_id: user.id,
    evaluated: result.evaluated,
    matchesCreated: result.created,
  });
}));

/**
 * Ostatnie dopasowania w systemie — diagnostyka i ops (ostatni cron).
 *
 * Bez JOIN-ów: pola przetargu są ZDENORMALIZOWANE w dokumencie dopasowania
 * (tender_title, tender_budget, tender_deadline...). collectionGroup zbiera
 * dopasowania ze wszystkich subkolekcji users/{uid}/matches naraz — wymaga indeksu
 * collection-group po `created_at` (firestore.indexes.json). Nazwę/NIP firmy
 * dobieramy z profilu: jeden odczyt na UNIKALNEGO usera, nie na dopasowanie.
 */
router.get('/recent-matches', ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  const snap = await getFirestore()
    .collectionGroup('matches')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const profiles = new Map(
    (await Promise.all(userIds.map((id) => users.findById(id))))
      .filter(Boolean)
      .map((u) => [u.id, u]),
  );

  const matches = rows
    // Odpowiednik SQL ORDER BY created_at DESC, confidence_score DESC.
    .sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at))
      || (b.confidence_score - a.confidence_score))
    .map((m) => {
      const u = profiles.get(m.user_id);
      return {
        id: m.id,
        user_id: m.user_id,
        confidence_score: m.confidence_score,
        match_reasoning: m.match_reasoning,
        scorer: m.scorer,
        created_at: m.created_at,
        company_name: u?.company_name ?? null,
        company_nip: u?.company_nip ?? null,
        tender_title: m.tender_title,
        tender_organization: m.tender_organization,
        tender_cpv: m.tender_cpv,
        tender_url: m.tender_url,
        tender_budget: m.tender_budget,
        tender_currency: m.tender_currency,
        tender_deadline: m.tender_deadline,
      };
    });

  res.json({ count: matches.length, matches });
}));

export default router;
