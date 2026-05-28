import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Sentry, sentryEnabled } from './lib/sentry.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import matchesRouter from './routes/matches.js';
import upgradeRouter from './routes/upgrade.js';
import webhooksRouter from './routes/webhooks.js';
import adminRouter from './routes/admin.js';
import legalRouter from './routes/legal.js';
import fitterBillingRouter from './routes/fitterBilling.js';
import fitterAiRouter from './routes/fitterAi.js';
import fitterChatRouter from './routes/fitterChat.js';
import fitterScanRouter from './routes/fitterScan.js';

/** Buduje i konfiguruje aplikację Express. */
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors());

  // Webhooki montowane PRZED express.json() — wymagają surowego body.
  app.use('/webhooks', webhooksRouter);

  app.use(express.json({ limit: '1mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
  });

  // Scan-iso route gets a dedicated, larger JSON parser (base64 ISO photos
  // run 3-8 MB) layered IN FRONT of the rate limiter + router for this path
  // only — global parser stays at 1 MB.
  app.use(
    '/api/fitter/scan-iso',
    express.json({ limit: '12mb' }),
    apiLimiter,
    fitterScanRouter,
  );

  app.use('/health', healthRouter);
  app.use('/auth', authLimiter, authRouter);
  app.use('/matches', apiLimiter, matchesRouter);
  app.use('/upgrade', apiLimiter, upgradeRouter);
  app.use('/admin', adminRouter);
  app.use('/api/fitter/billing', apiLimiter, fitterBillingRouter);
  app.use('/api/fitter/ai', apiLimiter, fitterAiRouter);
  app.use('/api/fitter/chat', apiLimiter, fitterChatRouter);
  app.use('/', legalRouter); // /polityka-prywatnosci, /regulamin

  app.use(notFoundHandler);
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);

  return app;
}
