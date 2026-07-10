import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Runner migracji SQLite.
 *
 * Do tej pory `migrate()` wykonywało `schema.sql` złożony z samych
 * `CREATE TABLE IF NOT EXISTS`, a `schema_meta.version` był zapisywany, lecz
 * nigdy nieczytany. Nie dało się dodać kolumny ani zmienić więzu na istniejącej
 * tabeli — czyli nie dało się rozwijać schematu na działającej produkcji.
 *
 * Kontrakt:
 *  • migracje to pliki `NNN_nazwa.sql` w katalogu, stosowane rosnąco po numerze,
 *  • każda w osobnej transakcji — błąd wycofuje całą migrację, bez śladu,
 *  • zastosowane są zapisywane w `schema_migrations` wraz z sumą kontrolną,
 *  • podmiana pliku już zastosowanego jest błędem, nie cichym pominięciem.
 *
 * Baza jest wstrzykiwana, nie importowana — dzięki temu testy działają na `:memory:`.
 */

const FILENAME = /^(\d+)_[\w-]+\.sql$/;

/** Tworzy rejestr migracji, jeśli go nie ma. Idempotentne. */
function ensureRegistry(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/** Identyfikatory zastosowanych migracji, w kolejności zastosowania. */
export function appliedMigrations(db) {
  ensureRegistry(db);
  return db.prepare('SELECT id FROM schema_migrations ORDER BY applied_at, id').all().map((r) => r.id);
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex').slice(0, 16);
}

/** Pliki migracji posortowane po numerze (nie alfabetycznie: 010 > 002). */
function readMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => ({ name, match: FILENAME.exec(name) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => ({
      id: name.replace(/\.sql$/, ''),
      order: Number(match[1]),
      sql: fs.readFileSync(path.join(dir, name), 'utf8'),
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * Stosuje wszystkie oczekujące migracje.
 * @returns {{applied: string[], skipped: number}}
 * @throws gdy migracja się nie powiedzie albo gdy zastosowany już plik został zmieniony
 */
export function runMigrations(db, dir) {
  ensureRegistry(db);

  const known = new Map(
    db.prepare('SELECT id, checksum FROM schema_migrations').all().map((r) => [r.id, r.checksum]),
  );

  const applied = [];
  let skipped = 0;

  for (const migration of readMigrations(dir)) {
    const sum = checksum(migration.sql);
    const previous = known.get(migration.id);

    if (previous !== undefined) {
      if (previous !== sum) {
        throw new Error(
          `Migracja ${migration.id} została już zastosowana, ale jej suma kontrolna się zmieniła. ` +
          'Nie edytuj wykonanych migracji — dopisz nową.',
        );
      }
      skipped++;
      continue;
    }

    // SQLite nie zmienia więzów ALTER-em — migracje muszą móc przebudować tabelę
    // (CREATE nowa → INSERT SELECT → DROP stara → RENAME), także taką, na którą
    // wskazują klucze obce. `PRAGMA foreign_keys` nie działa wewnątrz transakcji,
    // więc wyłączamy PRZED nią, a spójność sprawdzamy jawnie przed COMMIT.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      const naruszenia = db.prepare('PRAGMA foreign_key_check').all();
      if (naruszenia.length) {
        throw new Error(`narusza spójność kluczy obcych (${naruszenia.length} wierszy osieroconych)`);
      }
      db.prepare('INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, sum, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migracja ${migration.id} nie powiodła się: ${err.message}`, { cause: err });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    applied.push(migration.id);
  }

  return { applied, skipped };
}

/**
 * Zapisuje migracje jako zastosowane BEZ ich wykonywania.
 *
 * Dla świeżej bazy: `schema.sql` jest zawsze AKTUALNYM kształtem (już po
 * wszystkich zmianach), więc odtwarzanie na niej historycznych migracji byłoby
 * błędem — przebudowa tabeli cofnęłaby ją do starego kształtu. Świeża instalacja
 * dostaje schema.sql + stempel; istniejąca baza — wyłącznie runMigrations.
 * @returns {{stamped: string[]}}
 */
export function stampMigrations(db, dir) {
  ensureRegistry(db);
  const known = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id),
  );
  const stamped = [];
  for (const migration of readMigrations(dir)) {
    if (known.has(migration.id)) continue;
    db.prepare('INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)')
      .run(migration.id, checksum(migration.sql), new Date().toISOString());
    stamped.push(migration.id);
  }
  return { stamped };
}
