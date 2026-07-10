import { Router } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config.js';
import { cykl } from '../db/repos.js';

const router = Router();

/** Po ilu godzinach bez udanego cyklu uznajemy, że coś jest nie tak. */
const CYKL_PRZETERMINOWANY_H = 30; // cron biegnie raz na dobę — 6 h zapasu

/**
 * Health check — dla monitoringu zewnętrznego (UptimeRobot) i człowieka na dyżurze.
 *
 * Sprawdza trzy rzeczy, bo każda pęka inaczej:
 *  • czy Firestore odpowiada (503, jeśli nie),
 *  • **czy dzienny cykl w ogóle się wykonał** — bez tego „martwy cron" jest
 *    niewykrywalny: API odpowiada, baza żyje, a użytkownicy po prostu przestają
 *    dostawać przetargi (audyt 2026-07-10),
 *  • jaka wersja kodu działa — przy incydencie pierwsze pytanie brzmi „co jest wdrożone".
 */
router.get('/', async (_req, res) => {
  let dbOk = false;
  let ostatniCykl = null;

  try {
    await getFirestore().collection('_health').limit(1).get();
    dbOk = true;
    ostatniCykl = await cykl.ostatniPrzebieg();
  } catch { /* zgłoszone w polu db */ }

  const godzinOdCyklu = ostatniCykl?.zakonczony_o
    ? (Date.now() - new Date(ostatniCykl.zakonczony_o).getTime()) / 3_600_000
    : null;
  const cronOk = godzinOdCyklu !== null && godzinOdCyklu < CYKL_PRZETERMINOWANY_H;

  /*
   * Brak śladu cyklu NIE daje 503: świeżo wdrożony projekt czeka na pierwszy przebieg
   * i alarmowanie przez pierwszą dobę byłoby fałszywe. Operator widzi jednak
   * `cron.ok = false` i `ostatni_przebieg = null` — jeśli to trwa dłużej niż dobę,
   * cron nigdy nie wystartował.
   */
  const zdrowy = dbOk && (cronOk || ostatniCykl === null);

  res.status(zdrowy ? 200 : 503).json({
    status: zdrowy ? 'ok' : 'degraded',
    app: env.APP_NAME,
    platform: 'firebase',
    db: dbOk,
    // K_REVISION ustawia platforma przy każdym wdrożeniu.
    wersja: process.env.K_REVISION ?? 'nieznana',
    cron: {
      ok: cronOk,
      ostatni_przebieg: ostatniCykl?.zakonczony_o ?? null,
      godzin_temu: godzinOdCyklu === null ? null : Number(godzinOdCyklu.toFixed(1)),
      ostatni_wynik: ostatniCykl?.wynik ?? null,
    },
  });
});

export default router;
