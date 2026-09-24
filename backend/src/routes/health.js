import { Router } from 'express';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { statusKopii } from '../services/backup.js';

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
    /*
     * Nieudany backup NIE zmienia kodu odpowiedzi: `/health` jest healthcheckiem
     * wdrożenia Railway, więc 503 zablokowałby deploy zamiast cokolwiek naprawić.
     * Widoczne pole wystarczy, żeby cisza nie trwała 17 dni jak we wrześniu 2026.
     */
    kopia_zapasowa: statusKopii(),
  });
});

export default router;
