import { auditLogs } from '../db/repos.js';
import { logger } from './logger.js';

/**
 * Zapisuje wpis audytu (RODO). Nigdy nie rzuca — błąd audytu nie może wywrócić
 * właściwej operacji.
 *
 * Zwraca obietnicę (2026-09-25), która zawsze się spełnia. Zwykłe wywołania mogą
 * ją zignorować (fire-and-forget), ale ścieżki krytyczne (reset hasła, zmiana
 * hasła/e-maila, usunięcie konta) robią `await`: Cloud Functions zamrażają CPU
 * po odpowiedzi, więc wpis nieczekany potrafi nie powstać wcale (klasa D-044).
 * @returns {Promise<void>}
 */
export function audit({ userId = null, action, detail = null, ip = null }) {
  return Promise.resolve()
    .then(() => auditLogs.record({ userId, action, detail: detail ? JSON.stringify(detail) : null, ip }))
    .catch((err) => logger.error({ err: err.message }, 'Nie udało się zapisać wpisu audytu'));
}
