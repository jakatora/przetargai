import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * /health MUSI widzieć awarię ŹRÓDŁA, nie tylko ciszę crona.
 *
 * Audyt 2026-09-23, dowód live: cykl zakończony błędem na OBU źródłach
 * (BZP timeout, TED 429) dawał `status: "ok"` i HTTP 200, bo `cron.ok` liczyło
 * wyłącznie CZAS od ostatniego przebiegu. UptimeRobot świecił na zielono przez
 * cały czas trwania awarii pobierania — właściciel dowiedziałby się o niej
 * dopiero z rezygnacji klientów.
 *
 * Dodatkowo: bez licznika otwartych przetargów i liczników per źródło nie da
 * się odpowiedzieć na najprostsze pytanie audytu — „ile z tego, co źródło
 * opublikowało, faktycznie wylądowało w bazie".
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { cykl, tenders } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { getFirestore } = await import('firebase-admin/firestore');

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

async function wyczyscSlad() {
  await getFirestore().collection('_health').doc('daily_cycle').delete();
}

const UDANY = {
  ok: true,
  fetched: 12,
  newTenders: 5,
  skipped: 0,
  matchesCreated: 3,
  zrodla: { bzp: { fetched: 12, newTenders: 5, surowe: 20, odrzucone: 1, zduplikowane: 7, pominiete: 0 } },
};

test('cykl bez błędów => 200 ok (nie wolno alarmować na wyrost)', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg(UDANY);

  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 200);
  assert.equal(cialo.status, 'ok');
  assert.deepEqual(cialo.cron.zrodla_z_bledem, []);
});

test('KRYTYCZNE: błąd JEDNEGO aktywnego źródła => HTTP 503 degraded', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg({
    ...UDANY,
    zrodla: {
      bzp: { fetched: 1330, newTenders: 188 },
      ted: { fetched: 0, newTenders: 0, error: 'TED API odpowiedziało 429' },
    },
  });

  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 503, 'monitoring zewnetrzny MUSI to zobaczyć');
  assert.equal(cialo.status, 'degraded');
  assert.deepEqual(cialo.cron.zrodla_z_bledem, ['ted']);
  assert.equal(cialo.cron.ok, true, 'cron wystartował — zepsute jest ŹRÓDŁO, nie harmonogram');
});

test('cykl z ok:false => HTTP 503 degraded', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg({ ok: false, error: 'padly wszystkie zrodla', fetched: 0, newTenders: 0, zrodla: {} });

  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 503);
  assert.equal(cialo.status, 'degraded');
});

test('/health pokazuje per źródło: ostatni sukces i ostatni błąd', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg({ ...UDANY, zrodla: { bzp: { fetched: 1, newTenders: 1 } } });
  await cykl.zapiszPrzebieg({ ...UDANY, ok: true, zrodla: { bzp: { fetched: 0, newTenders: 0, error: 'timeout' } } });

  const { cialo } = await zapytajHealth();
  const bzp = cialo.cron.zrodla.bzp;
  assert.ok(bzp.ostatni_sukces_o, 'operator musi wiedzieć, kiedy źródło ostatnio DZIAŁAŁO');
  assert.equal(bzp.ostatni_blad, 'timeout');
  assert.ok(bzp.ostatni_blad_o);
});

test('/health niesie liczniki przebiegu: pobrane / zapisane / odrzucone / zduplikowane', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg(UDANY);

  const { cialo } = await zapytajHealth();
  const bzp = cialo.cron.ostatni_wynik.zrodla.bzp;
  assert.equal(bzp.fetched, 12, 'unikalne ogłoszenia oddane do zapisu');
  assert.equal(bzp.newTenders, 5, 'zapisane jako nowe');
  assert.equal(bzp.odrzucone, 1, 'odrzucone przez normalizację (np. brak identyfikatora)');
  assert.equal(bzp.zduplikowane, 7, 'scalone przez deduplikację — miara nakładki zapytań');
});

test('/health zwraca licznik OTWARTYCH przetargów (mianownik dla wszystkich pomiarów)', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg(UDANY);
  await tenders.upsert({
    externalId: `zdrowie-otwarty-${process.pid}`,
    title: 'Przetarg z otwartym terminem',
    deadline: '2099-01-01T00:00:00.000Z',
    source: 'bzp',
  });
  tenders.odswiezPule();

  const { cialo } = await zapytajHealth();
  assert.equal(typeof cialo.otwarte_przetargi, 'number');
  assert.ok(cialo.otwarte_przetargi >= 1,
    'bez tej liczby nie da się zweryfikować hipotezy o pułapie puli dopasowań');
});
