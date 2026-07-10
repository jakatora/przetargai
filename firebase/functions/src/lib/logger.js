import pino from 'pino';
import { env } from '../config.js';

/*
 * Cloud Functions zbiera stdout jako JSON — pino pasuje bez transportu.
 * Pole `severity` mapuje poziomy pino na poziomy Cloud Logging (inaczej
 * wszystko ląduje jako "Default" i filtrowanie w konsoli nie działa).
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  base: undefined,
  messageKey: 'message',
  formatters: {
    level(label) {
      const map = { trace: 'DEBUG', debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR', fatal: 'CRITICAL' };
      return { severity: map[label] ?? 'DEFAULT' };
    },
  },
});
