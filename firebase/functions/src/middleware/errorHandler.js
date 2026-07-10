import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

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

  /*
   * Google Error Reporting zbiera błędy automatycznie, ale TYLKO te, które wylecą
   * z funkcji. Nasz handler je przechwytuje, więc bez tego wpisu żaden błąd 500
   * nie trafiłby do panelu ani do alertów — zostałby zwykłą linijką w logu, której
   * nikt nie czyta. Zamiast dokładać Sentry, logujemy w formacie, który Error
   * Reporting rozpoznaje: severity ERROR + pełny stack w polu `message`.
   */
  console.error(JSON.stringify({
    severity: 'ERROR',
    '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
    message: err?.stack || String(err?.message ?? err),
    context: {
      httpRequest: {
        method: req.method,
        url: req.originalUrl,
        // Bez treści żądania i nagłówków — mogą zawierać hasło albo token.
        responseStatusCode: 500,
      },
      user: req.user?.id,
    },
  }));

  logger.error({ err: err?.message }, 'Nieobsłużony błąd');
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Wewnętrzny błąd serwera' },
  });
}
