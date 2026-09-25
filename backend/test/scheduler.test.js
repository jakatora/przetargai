import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedulerJobs, startScheduler, stopScheduler } from '../src/jobs/scheduler.js';
import { env } from '../src/config/env.js';

/*
 * Wymóg użytkownika: aplikacja codziennie „koło 12" sprawdza strony z przetargami.
 *
 * Pułapka strefy czasowej: Railway (produkcja) działa w UTC. Wyrażenie „0 12 * * *"
 * BEZ strefy odpaliłoby o 12:00 UTC = 13:00 (zima) / 14:00 (lato) czasu polskiego.
 * Dlatego każde zadanie niesie strefę Europe/Warsaw — „12" ma znaczyć polskie południe.
 */

const CFG = {
  TENDER_FETCH_CRON: '0 12 * * *',
  WALORYZACJA_MONITOR_CRON: '0 6 * * *',
  SWZ_MONITOR_CRON: '0 */6 * * *',
  PODPROGOWY_MONITOR_CRON: '0 7 * * *',
  SEJF_MONITOR_CRON: '0 8 * * *',
  DOSTEPNOSC_PLATFORMY_CRON: '*/15 * * * *',
  BACKUP_CRON: '0 3 * * *',
  SCHEDULER_TZ: 'Europe/Warsaw',
  LEGACY_PRZETARG_ENABLED: true,
};

/*
 * LEGACY cron PrzetargAI (2026-09-25, decyzja D-031). `tender-fetch` co przebieg oceniał
 * przez AI (Haiku) te same pary co Firebase — podwójna praca i podwójny koszt. Żaden moduł
 * mostu (/api/przetarg/*) nie czyta `tenders`/`matches`, więc domyślnie zadanie jest
 * WYCIĘTE; monitory modułów mostu zostają.
 */
const MONITORY_MOSTU = ['waloryzacja-monitor', 'swz-monitor', 'podprogowy-monitor', 'sejf-monitor', 'dostepnosc-platformy', 'backup'];

test('LEGACY_PRZETARG_ENABLED=false — bez tender-fetch, monitory modułów mostu zostają', () => {
  const nazwy = schedulerJobs({ ...CFG, LEGACY_PRZETARG_ENABLED: false }).map((j) => j.name);
  assert.ok(!nazwy.includes('tender-fetch'), 'legacy pobieranie + matching AI wycięte');
  for (const n of MONITORY_MOSTU) assert.ok(nazwy.includes(n), `brak zadania ${n}`);
});

test('LEGACY_PRZETARG_ENABLED=true — harmonogram jak dotąd (z tender-fetch)', () => {
  const nazwy = schedulerJobs(CFG).map((j) => j.name);
  assert.deepEqual(nazwy, ['tender-fetch', ...MONITORY_MOSTU]);
});

test('KONFIG: domyślnie legacy cron PrzetargAI jest wyłączony', () => {
  assert.equal(env.LEGACY_PRZETARG_ENABLED, false);
});

test('startScheduler — każde zadanie z noOverlap (node-cron 4 domyślnie pozwala na nakładanie)', () => {
  const zarejestrowane = [];
  const cronAtrapa = {
    validate: () => true,
    schedule: (expression, fn, opcje) => {
      zarejestrowane.push({ expression, opcje });
      return { stop() {} };
    },
  };
  startScheduler({ cfg: { ...CFG, LEGACY_PRZETARG_ENABLED: false }, cronImpl: cronAtrapa });
  stopScheduler();
  assert.equal(zarejestrowane.length, MONITORY_MOSTU.length);
  for (const { opcje } of zarejestrowane) {
    assert.equal(opcje.noOverlap, true, 'przebieg dłuższy niż interwał nie odpala drugiego równolegle');
    assert.equal(opcje.timezone, 'Europe/Warsaw');
  }
});

test('schedulerJobs — pobieranie przetargów codziennie o 12:00', () => {
  const fetch = schedulerJobs(CFG).find((j) => j.name === 'tender-fetch');
  assert.ok(fetch, 'brak zadania pobierania przetargów');
  assert.equal(fetch.expression, '0 12 * * *');
});

test('schedulerJobs — codzienny monitoring waloryzacji (podzadanie 11/12)', () => {
  const job = schedulerJobs(CFG).find((j) => j.name === 'waloryzacja-monitor');
  assert.ok(job, 'brak zadania monitoringu waloryzacji');
  assert.equal(job.expression, '0 6 * * *');
  assert.equal(typeof job.run, 'function');
});

test('schedulerJobs — cykliczny monitor publikacji SWZ (podzadanie 5/7)', () => {
  const job = schedulerJobs(CFG).find((j) => j.name === 'swz-monitor');
  assert.ok(job, 'brak zadania monitora publikacji SWZ');
  assert.equal(job.expression, '0 */6 * * *');
  assert.equal(typeof job.run, 'function');
});

test('schedulerJobs — cykliczny monitor zamówień podprogowych (podzadanie 6/7)', () => {
  const job = schedulerJobs(CFG).find((j) => j.name === 'podprogowy-monitor');
  assert.ok(job, 'brak zadania cyklicznego monitora podprogowego');
  assert.equal(job.expression, '0 7 * * *');
  assert.equal(typeof job.run, 'function');
});

test('schedulerJobs — cykliczny monitor sejfu dokumentów (podzadanie 6/7)', () => {
  const job = schedulerJobs(CFG).find((j) => j.name === 'sejf-monitor');
  assert.ok(job, 'brak zadania cyklicznego monitora sejfu');
  assert.equal(job.expression, '0 8 * * *');
  assert.equal(typeof job.run, 'function');
});

test('schedulerJobs — cykliczny monitor dostępności platformy (Czarna skrzynka 2/7)', () => {
  const job = schedulerJobs(CFG).find((j) => j.name === 'dostepnosc-platformy');
  assert.ok(job, 'brak zadania monitora dostępności platformy');
  assert.equal(job.expression, '*/15 * * * *');
  assert.equal(job.timezone, 'Europe/Warsaw');
  assert.equal(typeof job.run, 'function');
});

test('schedulerJobs — każde zadanie ma strefę Europe/Warsaw (nie UTC)', () => {
  for (const job of schedulerJobs(CFG)) {
    assert.equal(job.timezone, 'Europe/Warsaw', `zadanie ${job.name} bez polskiej strefy`);
  }
});

test('schedulerJobs — zadanie niesie funkcję uruchamiającą', () => {
  for (const job of schedulerJobs(CFG)) {
    assert.equal(typeof job.run, 'function', `zadanie ${job.name} bez handlera`);
  }
});

test('KONFIG: realny TENDER_FETCH_CRON tego backendu = raz dziennie w południe, nie co 6h', () => {
  // Regresja: domyślnie i w .env było „0 */6 * * *" (co 6 godzin). User chce raz
  // dziennie koło 12. Sprawdzamy faktycznie rozwiązaną konfigurację (schemat + .env).
  assert.equal(env.TENDER_FETCH_CRON, '0 12 * * *');
  assert.equal(env.SCHEDULER_TZ, 'Europe/Warsaw');
});
