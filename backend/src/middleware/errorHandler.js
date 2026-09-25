import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';

/** Middleware: zasób nieznaleziony (trasa nie pasuje). */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu' },
  });
}

/** Czytelny komunikat PL o przekroczonym limicie rozmiaru (limit w bajtach → „10 MB"). */
function komunikatZaDuzy(limitBajtow) {
  const mb = Number(limitBajtow) / (1024 * 1024);
  const limit = Number.isFinite(mb) && mb > 0
    ? ` — limit to ${String(Math.round(mb * 10) / 10).replace('.', ',')} MB`
    : '';
  return `Plik lub treść żądania jest za duża${limit}. Zmniejsz plik (np. skompresuj PDF lub zdjęcie) i spróbuj ponownie.`;
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

  // Ciało ponad limit parsera trasy (2026-09-25). Wcześniej leciało jako 500 „Wewnętrzny
  // błąd serwera" (+ alarm w Sentry), choć to zwykły błąd wejścia — aplikacja nie mogła
  // powiedzieć użytkownikowi, że plik jest po prostu za duży. `err.limit` to limit trasy
  // w bajtach (body-parser), więc komunikat podaje realną granicę, a nie zgadywaną.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'ZA_DUZY_PLIK', message: komunikatZaDuzy(err.limit) },
    });
  }

  logger.error({ err: err?.message, stack: err?.stack }, 'Nieobsłużony błąd');
  captureException(err);
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Wewnętrzny błąd serwera' },
  });
}
