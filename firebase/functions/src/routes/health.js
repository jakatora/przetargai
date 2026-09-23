import { Router } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config.js';
import { cykl, tenders, oknoBzp } from '../db/repos.js';
import { logger } from '../lib/logger.js';

const router = Router();

/** Po ilu godzinach bez udanego cyklu uznajemy, że coś jest nie tak. */
const CYKL_PRZETERMINOWANY_H = 30; // cron biegnie raz na dobę — 6 h zapasu

/** Nazwy źródeł, które w ostatnim przebiegu zgłosiły błąd. */
function zrodlaZBledem(wynik) {
  return Object.entries(wynik?.zrodla ?? {})
    .filter(([, statystyki]) => statystyki?.error)
    .map(([nazwa]) => nazwa)
    .sort();
}

/**
 * Health check — dla monitoringu zewnętrznego (UptimeRobot) i człowieka na dyżurze.
 *
 * Sprawdza cztery rzeczy, bo każda pęka inaczej:
 *  • czy Firestore odpowiada (503, jeśli nie),
 *  • **czy dzienny cykl w ogóle się wykonał** — bez tego „martwy cron" jest
 *    niewykrywalny: API odpowiada, baza żyje, a użytkownicy po prostu przestają
 *    dostawać przetargi (audyt 2026-07-10),
 *  • **czy cykl skończył się BEZ błędu źródła** — audyt 2026-09-23 zmierzył na
 *    żywo cykl zakończony błędem na OBU źródłach (BZP timeout, TED 429), który
 *    mimo to raportował `status: "ok"`. Monitoring nie miał szans zobaczyć awarii
 *    pobierania, bo `cron.ok` liczyło wyłącznie CZAS od ostatniego przebiegu,
 *  • jaka wersja kodu działa — przy incydencie pierwsze pytanie brzmi „co jest wdrożone".
 *
 * Do tego dwie liczby, bez których audyt kompletności jest zgadywaniem:
 * `otwarte_przetargi` (mianownik) i liczniki per źródło w `cron.ostatni_wynik`.
 */
router.get('/', async (_req, res) => {
  let dbOk = false;
  let ostatniCykl = null;
  let otwartePrzetargi = null;
  let stanOkna = null;

  try {
    await getFirestore().collection('_health').limit(1).get();
    dbOk = true;
    [ostatniCykl, stanOkna] = await Promise.all([cykl.ostatniPrzebieg(), oknoBzp.wczytaj()]);
  } catch { /* zgłoszone w polu db */ }

  if (dbOk) {
    // Licznik puli nie może wywrócić health-checku — brak indeksu albo chwilowy
    // błąd agregacji ma dać `null`, a nie fałszywy alarm o padniętej bazie.
    try {
      otwartePrzetargi = await tenders.policzOtwarte();
    } catch (err) {
      logger.warn({ err: err.message }, '/health: nie udało się policzyć otwartych przetargów');
    }
  }

  const godzinOdCyklu = ostatniCykl?.zakonczony_o
    ? (Date.now() - new Date(ostatniCykl.zakonczony_o).getTime()) / 3_600_000
    : null;
  const cronOk = godzinOdCyklu !== null && godzinOdCyklu < CYKL_PRZETERMINOWANY_H;

  const wynik = ostatniCykl?.wynik ?? null;
  const zBledem = zrodlaZBledem(wynik);

  /*
   * Ślady zapisane PRZED naprawą lepkiego merge'a (2026-09-24) niosą pola `error`,
   * których stary kod nie potrafił skasować — na produkcji siedział tam błąd sprzed
   * dwóch miesięcy, mimo w pełni udanych przebiegów. Liczenie ich jako awarii
   * zapaliłoby monitoring na czerwono przy pierwszym wdrożeniu tej naprawy i nauczyło
   * operatora ignorować alarm. Rozpoznajemy je po braku historii per źródło (pole
   * `zrodla` na dokumencie), którą zapisuje wyłącznie nowy kod. Pierwszy przebieg
   * po wdrożeniu nadpisuje ślad i alarm zaczyna działać w pełni.
   *
   * `ok: false` alarmuje ZAWSZE — to twarda awaria, nie residuum.
   */
  const sladSprzedNaprawa = ostatniCykl !== null && ostatniCykl.zrodla === undefined;
  // `ok !== false` zamiast `ok === true`: najstarsze ślady nie mają pola `ok`
  // i nie wolno ich zinterpretować jako awarii.
  const pobieranieOk = wynik === null
    || (wynik.ok !== false && (sladSprzedNaprawa || zBledem.length === 0));

  /*
   * Brak śladu cyklu NIE daje 503: świeżo wdrożony projekt czeka na pierwszy przebieg
   * i alarmowanie przez pierwszą dobę byłoby fałszywe. Operator widzi jednak
   * `cron.ok = false` i `ostatni_przebieg = null` — jeśli to trwa dłużej niż dobę,
   * cron nigdy nie wystartował.
   */
  const zdrowy = dbOk && (cronOk || ostatniCykl === null) && pobieranieOk;

  res.status(zdrowy ? 200 : 503).json({
    status: zdrowy ? 'ok' : 'degraded',
    app: env.APP_NAME,
    platform: 'firebase',
    db: dbOk,
    // K_REVISION ustawia platforma przy każdym wdrożeniu.
    wersja: process.env.K_REVISION ?? 'nieznana',
    // Mianownik dla pytania „czy widzimy cały rynek" (§3.4 audytu).
    otwarte_przetargi: otwartePrzetargi,
    /*
     * Stan domykania okna BZP (P0-2). `doby_niedomkniete > 0` znaczy, że w oknie
     * `BZP_LOOKBACK_DAYS` są doby, których jeszcze nie pobraliśmy w całości —
     * to jedyny zewnętrzny sygnał niekompletności danych źródłowych.
     */
    bzp_okno: stanOkna?.ostatni_przebieg
      ? {
        zakonczony_o: stanOkna.ostatni_przebieg.zakonczony_o ?? null,
        doby_okna: stanOkna.ostatni_przebieg.doby_okna ?? null,
        doby_niedomkniete: stanOkna.ostatni_przebieg.doby_niedomkniete ?? null,
        fetched: stanOkna.ostatni_przebieg.fetched ?? null,
        newTenders: stanOkna.ostatni_przebieg.newTenders ?? null,
        error: stanOkna.ostatni_przebieg.error ?? null,
      }
      : null,
    cron: {
      ok: cronOk,
      ostatni_przebieg: ostatniCykl?.zakonczony_o ?? null,
      godzin_temu: godzinOdCyklu === null ? null : Number(godzinOdCyklu.toFixed(1)),
      // Awaria źródła jest osobnym sygnałem niż milczący cron — mylenie ich
      // kosztowało tygodnie niezauważonej niekompletności danych.
      zrodla_z_bledem: zBledem,
      // true = ślad pochodzi z kodu sprzed naprawy lepkiego merge'a, więc pola
      // `error` mogą być residuum sprzed tygodni i NIE zapalają alarmu.
      slad_sprzed_naprawy: sladSprzedNaprawa,
      // Trwała historia: kiedy źródło ostatnio DZIAŁAŁO i kiedy ostatnio padło.
      zrodla: ostatniCykl?.zrodla ?? {},
      ostatni_wynik: wynik,
    },
  });
});

export default router;
