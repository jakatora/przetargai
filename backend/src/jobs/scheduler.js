import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runTenderFetch } from './fetchTenders.js';
import { runWaloryzacjaMonitor } from './monitorWaloryzacji.js';
import { runSwzMonitor } from './monitorSwz.js';
import { runPodprogowyMonitor } from './monitorPodprogowy.js';
import { runSejfMonitor } from './monitorSejf.js';
import { runDostepnoscMonitor } from './dostepnosc-platformy.js';
import { createBackup } from '../services/backup.js';

const tasks = [];

/**
 * Definicja zadań harmonogramu — czysta, żeby dało się ją przetestować bez timerów.
 * Każde zadanie niesie strefę: produkcja chodzi w UTC, a „12" ma znaczyć polskie
 * południe, nie 13/14. Patrz env.SCHEDULER_TZ i test/scheduler.test.js.
 * @param {typeof env} [cfg] konfiguracja (wstrzykiwalna w testach)
 */
export function schedulerJobs(cfg = env) {
  return [
    {
      name: 'tender-fetch',
      expression: cfg.TENDER_FETCH_CRON,
      timezone: cfg.SCHEDULER_TZ,
      run: () => runTenderFetch({ pages: 2 }),
    },
    {
      name: 'waloryzacja-monitor',
      expression: cfg.WALORYZACJA_MONITOR_CRON,
      timezone: cfg.SCHEDULER_TZ,
      run: () => runWaloryzacjaMonitor(),
    },
    {
      name: 'swz-monitor',
      expression: cfg.SWZ_MONITOR_CRON,
      timezone: cfg.SCHEDULER_TZ,
      run: () => runSwzMonitor(),
    },
    {
      name: 'podprogowy-monitor',
      expression: cfg.PODPROGOWY_MONITOR_CRON,
      timezone: cfg.SCHEDULER_TZ,
      run: () => runPodprogowyMonitor(),
    },
    {
      name: 'sejf-monitor',
      expression: cfg.SEJF_MONITOR_CRON,
      timezone: cfg.SCHEDULER_TZ,
      run: () => runSejfMonitor(),
    },
    {
      name: 'dostepnosc-platformy',
      expression: cfg.DOSTEPNOSC_PLATFORMY_CRON,
      timezone: cfg.SCHEDULER_TZ,
      run: () => runDostepnoscMonitor(),
    },
    {
      name: 'backup',
      expression: cfg.BACKUP_CRON,
      timezone: cfg.SCHEDULER_TZ,
      run: () => createBackup(),
    },
  ];
}

function schedule({ name, expression, timezone, run }) {
  const valid = typeof cron.validate === 'function' ? cron.validate(expression) : true;
  if (!valid) {
    logger.error({ name, expression }, 'Nieprawidłowe wyrażenie cron — zadanie pominięte');
    return;
  }
  tasks.push(
    cron.schedule(expression, async () => {
      logger.info({ name }, 'Scheduler: start zadania');
      try {
        await run();
      } catch (err) {
        logger.error({ name, err: err.message }, 'Scheduler: błąd zadania');
      }
    }, { timezone }),
  );
  logger.info({ name, expression, timezone }, 'Scheduler: zadanie zarejestrowane');
}

/** Uruchamia harmonogram: codzienne pobieranie przetargów + kopie zapasowe. */
export function startScheduler() {
  for (const job of schedulerJobs()) schedule(job);
}

/** Zatrzymuje wszystkie zadania (przy zamykaniu serwera). */
export function stopScheduler() {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
