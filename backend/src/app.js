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
import fitterJobsRouter from './routes/fitterJobs.js';
import przetargUmowaRouter from './routes/przetargUmowa.js';
import przetargZobowiazanieRouter from './routes/przetargZobowiazanie.js';
import radarSwzRouter from './routes/radarSwz.js';
import radarPodprogowyRouter from './routes/radarPodprogowy.js';
import sejfDokumentowRouter from './routes/sejfDokumentow.js';

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
  // Klucz administratora można było zgadywać bez żadnego ograniczenia — /admin
  // był jedynym routerem bez limitera (audyt 2026-07-09).
  const adminLimiter = rateLimit({
    windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
  });
  /*
   * Trasy AI są nieuwierzytelnione i każde żądanie kosztuje realne pieniądze
   * (skan ISO to wywołanie Sonneta z wizją, ~$0,02). Wspólny limit 120/min/IP
   * pozwalał wypompować miesięczny budżet w kilka godzin z jednego adresu.
   * Bramka budżetu w services/ai.js jest ostatnią linią obrony; ten limiter
   * ma sprawić, żeby do niej nie dochodziło.
   */
  const aiLimiter = rateLimit({
    windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Za dużo żądań AI. Odczekaj chwilę.' } },
  });

  // Scan-iso route gets a dedicated, larger JSON parser (base64 ISO photos
  // run 3-8 MB) layered IN FRONT of the rate limiter + router for this path
  // only — global parser stays at 1 MB.
  app.use(
    '/api/fitter/scan-iso',
    express.json({ limit: '12mb' }),
    aiLimiter,
    fitterScanRouter,
  );

  app.use('/health', healthRouter);
  app.use('/auth', authLimiter, authRouter);
  app.use('/matches', apiLimiter, matchesRouter);
  app.use('/upgrade', apiLimiter, upgradeRouter);
  app.use('/admin', adminLimiter, adminRouter);
  app.use('/api/fitter/billing', apiLimiter, fitterBillingRouter);
  app.use('/api/fitter/ai', aiLimiter, fitterAiRouter);
  app.use('/api/fitter/chat', apiLimiter, fitterChatRouter);
  app.use('/api/fitter/jobs', apiLimiter, fitterJobsRouter);
  // Analiza projektu umowy — treść bywa duża (całe SWZ/umowa, docelowo PDF),
  // więc trasa dostaje własny, większy parser JSON ponad globalnym limitem 1 MB.
  app.use('/api/przetarg/umowa', express.json({ limit: '10mb' }), apiLimiter, przetargUmowaRouter);
  // Eksport zobowiązania podmiotu (art. 118 Pzp) — małe pola tekstowe, globalny
  // parser JSON (1 MB) wystarcza; „Pożycz doświadczenie" 8/12.
  app.use('/api/przetarg/zobowiazanie', apiLimiter, przetargZobowiazanieRouter);
  // Radar SWZ — analiza treści SWZ/umowy/przedmiaru (podzadanie 3/7). Wejście bywa
  // duże (całe dokumenty), więc trasa dostaje własny, większy parser JSON (10 MB)
  // ponad globalnym limitem 1 MB — jak /api/przetarg/umowa.
  app.use('/api/przetarg/swz', express.json({ limit: '10mb' }), apiLimiter, radarSwzRouter);
  // Radar zamówień podprogowych (poniżej 170 tys. zł) — preferencje + scalony strumień
  // + ręczne odświeżenie (podzadanie 6/7). Małe payloady (filtry/preferencje), więc
  // globalny parser JSON (1 MB) wystarcza; pod limiterem API jak reszta tras.
  app.use('/api/przetarg/podprogowe', apiLimiter, radarPodprogowyRouter);
  // Sejf dokumentów firmy — lista z licznikiem świeżości + upload ORYGINAŁÓW (XML/
  // podpisany PDF w base64; podpisane PDF-y bywają wielomegabajtowe), więc trasa dostaje
  // własny, większy parser JSON (10 MB) ponad globalnym limitem 1 MB — jak /umowa i /swz.
  app.use('/api/przetarg/sejf', express.json({ limit: '10mb' }), apiLimiter, sejfDokumentowRouter);
  app.use('/', legalRouter); // /polityka-prywatnosci, /regulamin

  app.use(notFoundHandler);
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);

  return app;
}
