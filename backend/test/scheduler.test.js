import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedulerJobs } from '../src/jobs/scheduler.js';
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
  PODPROGOWY_MONITOR_CRON: '0 7 * * *',
  BACKUP_CRON: '0 3 * * *',
  SCHEDULER_TZ: 'Europe/Warsaw',
};

test('schedulerJobs — pobieranie przetargów codziennie o 12:00', () => {
  const fetch = schedulerJobs(CFG).find((j) => j.name === 'tender-fetch');
  assert.ok(fetch, 'brak zadania pobierania przetargów');
  assert.equal(fetch.expression, '0 12 * * *');
});

test('schedulerJobs — cykliczny monitor zamówień podprogowych (podzadanie 6/7)', () => {
  const job = schedulerJobs(CFG).find((j) => j.name === 'podprogowy-monitor');
  assert.ok(job, 'brak zadania cyklicznego monitora podprogowego');
  assert.equal(job.expression, '0 7 * * *');
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
