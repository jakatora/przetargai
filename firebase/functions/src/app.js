import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config.js';
import { kluczKlienta } from './lib/clientKey.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import matchesRouter from './routes/matches.js';
import upgradeRouter from './routes/upgrade.js';
import webhooksRouter from './routes/webhooks.js';
import adminRouter from './routes/admin.js';
import legalRouter from './routes/legal.js';
import demoRouter from './routes/demo.js';

/**
 * Aplikacja Express opakowana w jedną funkcję HTTPS (D-024).
 * Trasy `/api/fitter/*` NIE przechodzą — Fitter Welder Pro został na Railway.
 */
export function createApp() {
  const app = express();

  // Cloud Functions stoją za proxy Google. Bez tego `req.ip` to adres proxy,
  // a limiter dławiłby WSZYSTKICH użytkowników jednym licznikiem.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors());

  // W Functions surowe body jest dostępne jako `req.rawBody` niezależnie od
  // parsera, więc webhook Stripe nie wymaga montowania przed express.json().
  app.use(express.json({ limit: '1mb' }));

  /*
   * UWAGA o skali: liczniki express-rate-limit żyją w pamięci INSTANCJI. Przy
   * maxInstances=10 realny limit jest do 10× wyższy niż deklarowany. To świadomy
   * kompromis na start — twardszy limit wymagałby licznika w Firestore (koszt
   * zapisu na każde żądanie). Właściwym bezpiecznikiem kosztów AI jest `aiQuota`
   * (per użytkownik, w bazie), nie ten limiter.
   */
  const wspolne = { standardHeaders: true, legacyHeaders: false, keyGenerator: kluczKlienta };

  const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, ...wspolne });

  // Wyłącznie trasy, na których zgadywanie ma sens: logowanie i zakładanie konta.
  // Audyt 2026-07-09: dawniej limiter obejmował CAŁE /auth, więc `GET /auth/me`
  // i `PUT /auth/me/push-token` też się liczyły — przy CGNAT operatorów komórkowych
  // dziesiątki użytkowników dzielą jedno IP i wspólnie wyczerpywały 30 żądań/15 min.
  const zgadywanieHaselLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, ...wspolne });

  // Klucz administratora dawniej można było zgadywać bez żadnego ograniczenia.
  const adminLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, ...wspolne });

  app.use('/webhooks', webhooksRouter);
  app.use('/health', healthRouter);
  // Dokumenty wymagane przez App Store / Google Play (bez landingu — D-016).
  app.use('/', legalRouter);

  app.use('/auth/login', zgadywanieHaselLimiter);
  app.use('/auth/register', zgadywanieHaselLimiter);
  app.use('/auth', apiLimiter, authRouter);

  app.use('/matches', apiLimiter, matchesRouter);
  app.use('/upgrade', apiLimiter, upgradeRouter);
  app.use('/admin', adminLimiter, adminRouter);

  /*
   * Przełącznik planów DEMO — montowany TYLKO poza produkcją (D-040).
   * Na produkcji ścieżka nie istnieje (404); pilnuje tego
   * test/demoTierProdukcja.test.js. NIE montować bezwarunkowo.
   */
  if (env.NODE_ENV !== 'production') {
    app.use('/demo', apiLimiter, demoRouter);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
