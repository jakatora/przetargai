import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

/*
 * Audyt 2026-07-10: nie było żadnego sygnału, czy dzienny cykl w ogóle się wykonał.
 * „Martwy cron" jest najgroźniejszą cichą awarią tego produktu: API odpowiada 200,
 * baza żyje, monitoring świeci na zielono — a użytkownicy po prostu przestają
 * dostawać przetargi i dowiadujemy się o tym z rezygnacji z subskrypcji.
 */


const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { cykl } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

/**
 * Odpytuje /health przez PRAWDZIWY serwer HTTP.
 *
 * Ręczna atrapa obiektu odpowiedzi nie wystarcza — `helmet` woła na nim
 * `removeHeader`, więc atrapa testowałaby wyłącznie samą siebie.
 */
async function zapytajHealth() {
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return { status: res.status, cialo: await res.json() };
  } finally {
    serwer.close();
  }
}

async function ustawZnacznikCyklu(godzinTemu) {
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('_health').doc('daily_cycle').set({
    zakonczony_o: new Date(Date.now() - godzinTemu * 3_600_000).toISOString(),
    wynik: { ok: true, matchesCreated: 3 },
  });
}

test('cykl.zapiszPrzebieg / ostatniPrzebieg — zapis i odczyt śladu', async () => {
  await cykl.zapiszPrzebieg({ ok: true, matchesCreated: 7 });
  const slad = await cykl.ostatniPrzebieg();
  assert.ok(slad.zakonczony_o, 'ślad musi mieć znacznik czasu');
  assert.equal(slad.wynik.matchesCreated, 7);
});

test('/health: świeży cykl => 200 ok', async () => {
  await ustawZnacznikCyklu(2);
  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 200);
  assert.equal(cialo.status, 'ok');
  assert.equal(cialo.db, true);
  assert.equal(cialo.cron.ok, true);
  assert.ok(cialo.cron.godzin_temu >= 1.9 && cialo.cron.godzin_temu <= 2.2);
});

test('KRYTYCZNE /health: milczący cron => 503 degraded', async () => {
  // Cron biegnie raz na dobę; 40 godzin ciszy oznacza, że nie wykonał się ani razu.
  await ustawZnacznikCyklu(40);
  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 503, 'monitoring MUSI to zobaczyć');
  assert.equal(cialo.status, 'degraded');
  assert.equal(cialo.cron.ok, false);
  assert.equal(cialo.db, true, 'baza działa — problemem jest wyłącznie cron');
});

test('/health: BZP „cicho puste" w dzień roboczy jest widoczne, ale nie zapala 503', async () => {
  const { getFirestore } = await import('firebase-admin/firestore');
  // Czwartek 2026-10-22 12:05 czasu polskiego — e-Zamówienia odpowiadało 403 HTML, cykl „ok" z zerem BZP.
  const zakonczony = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const dzien = new Date(new Date(zakonczony).toLocaleString('en-US', { timeZone: 'Europe/Warsaw' })).getDay();
  await getFirestore().collection('_health').doc('daily_cycle').set({
    zakonczony_o: zakonczony,
    zrodla: {},
    wynik: {
      ok: true, fetched: 1631, newTenders: 5,
      zrodla: {
        bzp: { fetched: 0, newTenders: 0, surowe: 0, odrzucone: 0, zapytania: 1 },
        ted: { fetched: 1631, newTenders: 5, surowe: 1631, odrzucone: 0, zapytania: 7 },
        baza_konkurencyjnosci: { fetched: 0, newTenders: 0, surowe: 1085, odrzucone: 0 },
      },
    },
  });
  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 200, 'informacyjne — dane dociągnie następne okno');
  const oczekiwane = dzien === 0 || dzien === 6 ? [] : ['bzp'];
  assert.deepEqual(cialo.cron.zrodla_cicho_puste, oczekiwane, 'BZP bez surowych ogłoszeń w dzień roboczy = cicho puste; TED pełny, BK pomijane');
});

test('zrodlaCichoPusteWCyklu — czysta reguła: weekend i stary ślad bez liczników nie alarmują', async () => {
  const { zrodlaCichoPusteWCyklu } = await import('../src/routes/health.js');
  const zero = { zrodla: { bzp: { surowe: 0, fetched: 0 }, ted: { surowe: 0, fetched: 0 } } };
  assert.deepEqual(zrodlaCichoPusteWCyklu(zero, '2026-10-22T10:05:00.000Z'), ['bzp', 'ted'], 'czwartek: oba źródła puste');
  assert.deepEqual(zrodlaCichoPusteWCyklu(zero, '2026-10-24T10:05:00.000Z'), [], 'sobota: cisza jest normalna');
  assert.deepEqual(zrodlaCichoPusteWCyklu({ ok: true, fetched: 0 }, '2026-10-22T10:05:00.000Z'), [], 'ślad sprzed liczników per źródło');
  assert.deepEqual(zrodlaCichoPusteWCyklu({ zrodla: { bzp: { surowe: 0, fetched: 0, error: 'HTTP 500' } } }, '2026-10-22T10:05:00.000Z'), [], 'jawny błąd idzie do zrodla_z_bledem, nie tu');
  assert.deepEqual(zrodlaCichoPusteWCyklu(null, null), []);
});

test('/health: zwraca wersję wdrożonego kodu', async () => {
  await ustawZnacznikCyklu(1);
  const { cialo } = await zapytajHealth();
  assert.ok(typeof cialo.wersja === 'string' && cialo.wersja.length,
    'przy incydencie pierwsze pytanie brzmi: co jest wdrożone');
});
