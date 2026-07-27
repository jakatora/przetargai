import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Cykliczny monitoring waloryzacji `runWaloryzacjaMonitor` — podzadanie 11/12
 * ulepszenia „pilnowanie waloryzacji i pułapek w umowie". Orkiestracja na realnej
 * (tymczasowej) bazie, z WSTRZYKNIĘTYM klientem GUS i powiadomieniem (bez sieci).
 *
 * Sprawdzamy end-to-end logikę joba:
 *  • wzrost cen ponad próg => alarm: powiadomienie + zapis wskaźnika + oznaczenie,
 *  • dedupe: drugi przebieg już nie powiadamia (alarm_wyslany = 1 wypada z puli),
 *  • wzrost poniżej progu => brak alarmu, ale wskaźnik zapisany (obserwacja),
 *  • umowa BEZ progu nie jest w ogóle sprawdzana (nie ma czego przekraczać),
 *  • błąd GUS dla jednego rekordu nie przerywa przebiegu.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-monitor-wal-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { users, umowyMonitorowane } = await import('../src/db/repos.js');
const { runWaloryzacjaMonitor } = await import('../src/jobs/monitorWaloryzacji.js');

let userId;

before(() => {
  migrate();
  userId = users.create({
    companyNip: null, companyName: null,
    email: `monitor-${process.pid}@t.pl`, passwordHash: 'h', keywords: ['budownictwo'],
  }).id;
});
after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

/** Fałszywy klient GUS: zwraca wskaźnik zależny od branży (bez sieci). */
function fakeGus(mapaBranza) {
  return async (branza) => mapaBranza[branza] ?? null;
}

/** Spy na powiadomienie — liczy wywołania i zwraca „wysłano jedno". */
function fakePowiadom() {
  const wywolania = [];
  const fn = async (user, ctx) => { wywolania.push({ user, ctx }); return { sent: 1 }; };
  fn.wywolania = wywolania;
  return fn;
}

test('wzrost ponad próg => alarm: powiadomienie + zapis wskaźnika + oznaczenie', async () => {
  const umowa = umowyMonitorowane.create({
    userId, branza: 'budownictwo', wskaznikBazowy: 100, prog: 10,
  });
  const powiadom = fakePowiadom();

  const wynik = await runWaloryzacjaMonitor({
    pobierzWskaznik: fakeGus({ budownictwo: { wartosc: 115, okres: '2026' } }),
    powiadom,
  });

  assert.equal(wynik.alarmy, 1, JSON.stringify(wynik));
  assert.equal(wynik.powiadomienia, 1);
  assert.equal(powiadom.wywolania.length, 1);
  assert.equal(powiadom.wywolania[0].ctx.wzrost, 15, 'wzrost 100 -> 115 to 15%');
  assert.equal(powiadom.wywolania[0].ctx.prog, 10);

  const rec = umowyMonitorowane.findByIdForUser(umowa.id, userId);
  assert.equal(rec.wskaznik_aktualny, 115, 'aktualny wskaźnik zapisany');
  assert.equal(rec.wskaznik_aktualny_okres, '2026');
  assert.equal(rec.alarm_wyslany, 1, 'alarm oznaczony jako wysłany');
});

test('dedupe: drugi przebieg tej samej umowy już nie powiadamia', async () => {
  // Umowa z poprzedniego testu ma alarm_wyslany = 1 → wypada z puli doSprawdzenia.
  const powiadom = fakePowiadom();
  const wynik = await runWaloryzacjaMonitor({
    pobierzWskaznik: fakeGus({ budownictwo: { wartosc: 130, okres: '2026' } }),
    powiadom,
  });
  assert.equal(powiadom.wywolania.length, 0, 'po wysłanym alarmie nie powiadamiamy w kółko');
});

test('wzrost poniżej progu => brak alarmu, ale wskaźnik zapisany (obserwacja)', async () => {
  const umowa = umowyMonitorowane.create({
    userId, branza: 'transport', wskaznikBazowy: 100, prog: 10,
  });
  const powiadom = fakePowiadom();

  const wynik = await runWaloryzacjaMonitor({
    pobierzWskaznik: fakeGus({ transport: { wartosc: 105, okres: '2026' } }),
    powiadom,
  });

  assert.equal(powiadom.wywolania.length, 0, '5% < 10% => brak alarmu');
  const rec = umowyMonitorowane.findByIdForUser(umowa.id, userId);
  assert.equal(rec.wskaznik_aktualny, 105, 'wskaźnik i tak zapisany');
  assert.equal(rec.alarm_wyslany, 0, 'bez alarmu — wróci w następnym cyklu');
});

test('umowa BEZ progu nie jest w ogóle sprawdzana', async () => {
  // Unikalna branża + fake GUS zwracający wartość TYLKO dla niej: gdyby rekord
  // bez progu trafił do puli, dostałby wskaźnik i zaalarmował. Że tak się NIE
  // dzieje, dowodzi, że filtr `prog IS NOT NULL` go wyklucza.
  const umowa = umowyMonitorowane.create({
    userId, branza: 'sprzatanie', wskaznikBazowy: 100, // prog: null
  });
  const powiadom = fakePowiadom();

  await runWaloryzacjaMonitor({
    pobierzWskaznik: fakeGus({ sprzatanie: { wartosc: 999, okres: '2026' } }),
    powiadom,
  });

  const rec = umowyMonitorowane.findByIdForUser(umowa.id, userId);
  assert.equal(rec.wskaznik_aktualny, null, 'rekord bez progu nie dostaje wskaźnika (poza pulą)');
  assert.equal(powiadom.wywolania.length, 0, 'brak progu => brak alarmu');
});

test('błąd GUS dla rekordu nie przerywa przebiegu (job liczy błąd i idzie dalej)', async () => {
  umowyMonitorowane.create({ userId, branza: 'energetyka', wskaznikBazowy: 100, prog: 5 });
  const powiadom = fakePowiadom();

  const wynik = await runWaloryzacjaMonitor({
    pobierzWskaznik: async () => { throw new Error('GUS 503'); },
    powiadom,
  });

  assert.ok(wynik.bledy >= 1, 'błąd rekordu policzony');
  assert.equal(wynik.ok, true, 'przebieg kończy się mimo błędu rekordu');
});
