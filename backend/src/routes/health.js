import { Router } from 'express';
import { env } from '../config/env.js';
import { db } from '../db/index.js';

const router = Router();
const startedAt = Date.now();

/** Health check — wykorzystywany przez UptimeRobot i platformę hostingową. */
router.get('/', (req, res) => {
  let dbOk = true;
  try {
    db.prepare('SELECT 1').get();
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    app: env.APP_NAME,
    env: env.NODE_ENV,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    db: dbOk,
  });
});

export default router;
