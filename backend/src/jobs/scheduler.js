import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runTenderFetch } from './fetchTenders.js';
import { createBackup } from '../services/backup.js';

const tasks = [];

function schedule(name, expression, handler) {
  const valid = typeof cron.validate === 'function' ? cron.validate(expression) : true;
  if (!valid) {
    logger.error({ name, expression }, 'Nieprawidłowe wyrażenie cron — zadanie pominięte');
    return;
  }
  tasks.push(
    cron.schedule(expression, async () => {
      logger.info({ name }, 'Scheduler: start zadania');
      try {
        await handler();
      } catch (err) {
        logger.error({ name, err: err.message }, 'Scheduler: błąd zadania');
      }
    }),
  );
  logger.info({ name, expression }, 'Scheduler: zadanie zarejestrowane');
}

/** Uruchamia harmonogram: cykliczne pobieranie przetargów + kopie zapasowe. */
export function startScheduler() {
  schedule('tender-fetch', env.TENDER_FETCH_CRON, () => runTenderFetch({ pages: 2 }));
  schedule('backup', env.BACKUP_CRON, () => createBackup());
}

/** Zatrzymuje wszystkie zadania (przy zamykaniu serwera). */
export function stopScheduler() {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
