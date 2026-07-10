import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';
import { runMigrations, stampMigrations } from './migrator.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Doprowadza bazę do aktualnego schematu. Idempotentne — bezpieczne przy każdym starcie.
 *
 * Dwie ścieżki, celowo rozdzielone:
 *  • ŚWIEŻA baza (brak tabeli `users`): dostaje `schema.sql` — zawsze AKTUALNY
 *    kształt — a migracje są tylko STEMPLOWANE jako zastosowane. Odtwarzanie ich
 *    na aktualnym kształcie byłoby błędem: przebudowa tabeli cofnęłaby ją do
 *    stanu historycznego.
 *  • ISTNIEJĄCA baza: `schema.sql` dokłada wyłącznie brakujące NOWE tabele
 *    (CREATE IF NOT EXISTS), a `migrations/` przeprowadza zmiany kształtu
 *    (ALTER, przebudowy) — każda w transakcji, z sumą kontrolną.
 *
 * Konsekwencja: każda zmiana istniejącej tabeli = wpis w `schema.sql` (dla
 * świeżych) ORAZ migracja w `migrations/` (dla działających baz).
 */
export function migrate() {
  const fresh = !db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'",
  ).get();

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  if (fresh) {
    const { stamped } = stampMigrations(db, MIGRATIONS_DIR);
    logger.info({ stamped }, 'Świeża baza — schemat aktualny, migracje ostemplowane');
    return { applied: [], skipped: stamped.length };
  }

  const { applied, skipped } = runMigrations(db, MIGRATIONS_DIR);
  logger.info({ applied, skipped }, 'Migracja bazy zakończona');
  return { applied, skipped };
}

if (isMainModule(import.meta.url)) {
  migrate();
  process.exit(0);
}
