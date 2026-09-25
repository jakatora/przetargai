import { Router } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config.js';
import { cykl, tenders, oknoBzp, oknoBk, oknoWynikow, oknoPlanow } from '../db/repos.js';
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
  let stanOknaBk = null;
  let stanOknaWynikow = null;
  let stanOknaPlanow = null;

  try {
    await getFirestore().collection('_health').limit(1).get();
    dbOk = true;
    [ostatniCykl, stanOkna, stanOknaBk, stanOknaWynikow, stanOknaPlanow] = await Promise.all([
      cykl.ostatniPrzebieg(), oknoBzp.wczytaj(), oknoBk.wczytaj(), oknoWynikow.wczytaj(),
      oknoPlanow.wczytaj(),
    ]);
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

  /*
   * Ogłoszenia POBRANE, a NIEZAPISANE (2026-09-25). Dawniej błąd zapisu kończył się
   * `pominiete++` przy `ok: true` i nikt tego nie widział. Checkpointy okien zostawiają
   * takie doby/ogłoszenia otwarte do ponowienia, ale dyżurny musi widzieć, że to się
   * dzieje — rosnąca liczba znaczy, że ponowienia też padają. Informacyjne: nie zapala
   * 503 (dane dociągnie następny przebieg okna), `null` = wszystko zapisane.
   */
  const niezapisane = {
    cykl: wynik?.skipped ?? 0,
    bzp_okno: stanOkna?.ostatni_przebieg?.skipped ?? 0,
    bk_okno: stanOknaBk?.ostatni_przebieg?.bledy_zapisu ?? stanOknaBk?.ostatni_przebieg?.skipped ?? 0,
  };
  const zapisNiekompletny = Object.values(niezapisane).some((n) => n > 0) ? niezapisane : null;

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
     * Licznik do TEGO mianownika (P0-5): ile przetargów realnie weszło do puli
     * dopasowań w ostatnim pobraniu. Dopóki `osiagnietoSufit` jest false,
     * `pobrane` powinno nadążać za `otwarte_przetargi` — rozjazd znaczy, że
     * część rynku wypada z dopasowań. Dawniej trzeba to było wyliczać z zewnątrz,
     * zestawiając `otwarte_przetargi` ze stałą 2000 zaszytą w kodzie.
     */
    pula: tenders.statystykiPuli(),
    zapis_niekompletny: zapisNiekompletny,
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
        ok: stanOkna.ostatni_przebieg.ok ?? null,
        skipped: stanOkna.ostatni_przebieg.skipped ?? null,
        // > 0 = doby z województwem na suficie 500: niekompletne, trzeba ciąć po godzinach.
        wojewodztwa_na_suficie: stanOkna.ostatni_przebieg.wojewodztwa_na_suficie ?? null,
        error: stanOkna.ostatni_przebieg.error ?? null,
      }
      : null,
    /*
     * Stan domykania okna Bazy Konkurencyjności (etap 3). Trzy liczby, których
     * nie da się wywnioskować z niczego innego:
     *  • `pokrycie_kompletne: false` — BK listuje w NIESTABILNEJ kolejności i przy
     *    niepełnym przejściu po prostu oddaje mniej, bez żadnego błędu. To jedyny
     *    zewnętrzny sygnał, że część rynku nie weszła do przebiegu.
     *  • `zaleglosc` — ile ogłoszeń czeka na pobranie szczegółu (wartość i CPV są
     *    tylko tam). Rosnąca zaległość znaczy, że okno się NIE domyka.
     *  • `anulowane` — ile postępowań wypadło z puli w ostatnim przebiegu.
     */
    bk_okno: stanOknaBk?.ostatni_przebieg
      ? {
        zakonczony_o: stanOknaBk.ostatni_przebieg.zakonczony_o ?? null,
        aktywne_w_zrodle: stanOknaBk.ostatni_przebieg.aktywne_w_zrodle ?? null,
        aktywne_pobrane: stanOknaBk.ostatni_przebieg.aktywne_pobrane ?? null,
        pokrycie_kompletne: stanOknaBk.ostatni_przebieg.pokrycie_kompletne ?? null,
        zaleglosc: stanOknaBk.ostatni_przebieg.zaleglosc ?? null,
        fetched: stanOknaBk.ostatni_przebieg.fetched ?? null,
        newTenders: stanOknaBk.ostatni_przebieg.newTenders ?? null,
        zaktualizowane: stanOknaBk.ostatni_przebieg.zaktualizowane ?? null,
        anulowane: stanOknaBk.ostatni_przebieg.anulowane ?? null,
        ok: stanOknaBk.ostatni_przebieg.ok ?? null,
        skipped: stanOknaBk.ostatni_przebieg.skipped ?? null,
        bledy_zapisu: stanOknaBk.ostatni_przebieg.bledy_zapisu ?? null,
        error: stanOknaBk.ostatni_przebieg.error ?? null,
      }
      : null,
    /*
     * Stan domykania okna ROZSTRZYGNIĘĆ (etap 6). Benchmark i karta „czy warto
     * startować" liczą się z tej kolekcji, więc `doby_niedomkniete > 0` znaczy,
     * że część rynku nie weszła do statystyki — a statystyka i tak pokaże liczbę.
     * Bez tego pola niekompletność byłaby niewidoczna.
     */
    wyniki_okno: stanOknaWynikow?.ostatni_przebieg
      ? {
        zakonczony_o: stanOknaWynikow.ostatni_przebieg.zakonczony_o ?? null,
        doby_okna: stanOknaWynikow.ostatni_przebieg.doby_okna ?? null,
        doby_niedomkniete: stanOknaWynikow.ostatni_przebieg.doby_niedomkniete ?? null,
        bzp_ogloszen: stanOknaWynikow.ostatni_przebieg.bzp_ogloszen ?? null,
        bzp_czesci: stanOknaWynikow.ostatni_przebieg.bzp_czesci ?? null,
        ted_ogloszen: stanOknaWynikow.ostatni_przebieg.ted_ogloszen ?? null,
        ted_czesci: stanOknaWynikow.ostatni_przebieg.ted_czesci ?? null,
        error: stanOknaWynikow.ostatni_przebieg.error ?? null,
      }
      : null,
    /*
     * Import planów postępowań (TED planning) do Radaru planów. Informacyjne —
     * awaria nie zapala 503, bo radar pokazuje wtedy wczorajszy indeks, a feed
     * ogłoszeń działa bez niego.
     */
    plany_okno: stanOknaPlanow?.ostatni_przebieg
      ? {
        zakonczony_o: stanOknaPlanow.ostatni_przebieg.zakonczony_o ?? null,
        dni: stanOknaPlanow.ostatni_przebieg.dni ?? null,
        pobrane: stanOknaPlanow.ostatni_przebieg.pobrane ?? null,
        aktywnych_w_indeksie: stanOknaPlanow.ostatni_przebieg.aktywnych_w_indeksie ?? null,
        error: stanOknaPlanow.ostatni_przebieg.error ?? null,
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
