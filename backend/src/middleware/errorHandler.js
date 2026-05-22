import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';

/** Middleware: zasób nieznaleziony (trasa nie pasuje). */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu' },
  });
}

/** Centralny handler błędów — mapuje wyjątki na odpowiedzi JSON. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }

  // Błąd parsera JSON (express.json()).
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BAD_JSON', message: 'Treść żądania nie jest poprawnym JSON-em' },
    });
  }

  logger.error({ err: err?.message, stack: err?.stack }, 'Nieobsłużony błąd');
  captureException(err);
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Wewnętrzny błąd serwera' },
  });
}
