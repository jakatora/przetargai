import { auditLogs } from '../db/repos.js';
import { logger } from './logger.js';

/**
 * Zapisuje wpis audytu (RODO). Fire-and-forget i nigdy nie rzuca — błąd audytu
 * nie może wywrócić właściwej operacji ani jej opóźnić.
 */
export function audit({ userId = null, action, detail = null, ip = null }) {
  auditLogs
    .record({ userId, action, detail: detail ? JSON.stringify(detail) : null, ip })
    .catch((err) => logger.error({ err: err.message }, 'Nie udało się zapisać wpisu audytu'));
}
