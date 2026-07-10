import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, appliedMigrations, stampMigrations } from '../src/db/migrator.js';

/*
 * Do dziś `migrate()` robiło `db.exec(schema.sql)` na samych CREATE TABLE IF NOT EXISTS.
 * `schema_meta.version` był ZAPISYWANY, ale nigdy nieczytany ani porównywany.
 * Nie dało się dodać kolumny do istniejącej tabeli ani zdjąć NOT NULL.
 * To blokowało całą migrację produktu.
 */

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

/** Tworzy katalog migracji z podanych plików. Zwraca ścieżkę. */
function migrationsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'przetargai-mig-'));
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql, 'utf8');
  }
  return dir;
}

test('runMigrations — tworzy tabelę schema_migrations przy pierwszym uruchomieniu', () => {
  const db = freshDb();
  runMigrations(db, migrationsDir({}));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes('schema_migrations'));
  db.close();
});

test('runMigrations — stosuje migracje w kolejności numerycznej, nie alfabetycznej', () => {
  const db = freshDb();
  const dir = migrationsDir({
    '010_trzecia.sql': 'CREATE TABLE trzecia (id INTEGER);',
    '002_druga.sql': 'CREATE TABLE druga (id INTEGER);',
    '001_pierwsza.sql': 'CREATE TABLE pierwsza (id INTEGER);',
  });
  const result = runMigrations(db, dir);
  assert.deepEqual(result.applied, ['001_pierwsza', '002_druga', '010_trzecia']);
  db.close();
});

test('runMigrations — jest idempotentny: drugie uruchomienie nic nie stosuje', () => {
  const db = freshDb();
  const dir = migrationsDir({ '001_tabela.sql': 'CREATE TABLE t (id INTEGER);' });

  const pierwsze = runMigrations(db, dir);
  const drugie = runMigrations(db, dir);

  assert.deepEqual(pierwsze.applied, ['001_tabela']);
  assert.deepEqual(drugie.applied, []);
  assert.equal(drugie.skipped, 1);
  db.close();
});

test('runMigrations — dokłada kolumnę do istniejącej tabeli (to było niemożliwe)', () => {
  const db = freshDb();
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);");
  const dir = migrationsDir({
    "001_theme.sql": "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system';",
  });

  runMigrations(db, dir);

  const kolumny = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(kolumny.includes('theme'), 'kolumna theme powinna istnieć');
  db.close();
});

test('runMigrations — migracja jest atomowa: błąd w środku nie zostawia śladu', () => {
  const db = freshDb();
  const dir = migrationsDir({
    '001_polowiczna.sql': 'CREATE TABLE ok_tabela (id INTEGER); INSERT INTO nie_ma_takiej VALUES (1);',
  });

  assert.throws(() => runMigrations(db, dir));

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(!tables.includes('ok_tabela'), 'częściowa zmiana musi zostać wycofana');
  assert.deepEqual(appliedMigrations(db), [], 'nieudana migracja nie może być zapisana jako zastosowana');
  db.close();
});

test('runMigrations — wykrywa podmianę już zastosowanej migracji', () => {
  const db = freshDb();
  const dir = migrationsDir({ '001_tabela.sql': 'CREATE TABLE t (id INTEGER);' });
  runMigrations(db, dir);

  // Ktoś edytuje plik, który został już wykonany na produkcji.
  fs.writeFileSync(path.join(dir, '001_tabela.sql'), 'CREATE TABLE t (id INTEGER, extra TEXT);', 'utf8');

  assert.throws(
    () => runMigrations(db, dir),
    /suma kontrolna|checksum/i,
    'zmiana zastosowanej migracji musi być wykryta, nie zignorowana',
  );
  db.close();
});

test('appliedMigrations — zwraca identyfikatory w kolejności zastosowania', () => {
  const db = freshDb();
  const dir = migrationsDir({
    '001_a.sql': 'CREATE TABLE a (id INTEGER);',
    '002_b.sql': 'CREATE TABLE b (id INTEGER);',
  });
  runMigrations(db, dir);
  assert.deepEqual(appliedMigrations(db), ['001_a', '002_b']);
  db.close();
});

test('runMigrations — przebudowa tabeli wskazywanej przez klucze obce (zdjęcie NOT NULL)', () => {
  // SQLite nie umie ALTER-em zdjąć NOT NULL — jedyna droga to przebudowa tabeli.
  // Ta tabela jest celem FK z tabeli dzieci; runner musi to przeżyć bez
  // naruszenia spójności (PRAGMA foreign_keys nie działa wewnątrz transakcji,
  // więc runner musi wyłączać FK PRZED transakcją i sprawdzać spójność PO).
  const db = freshDb();
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, nip TEXT NOT NULL);
    CREATE TABLE matches (id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    INSERT INTO users VALUES ('u1', '123');
    INSERT INTO matches VALUES ('m1', 'u1');
  `);
  const dir = migrationsDir({
    '001_nip_opcjonalny.sql': `
      CREATE TABLE users_new (id TEXT PRIMARY KEY, nip TEXT);
      INSERT INTO users_new SELECT id, nip FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `,
  });

  runMigrations(db, dir);

  // Dane przeżyły, NOT NULL zdjęty, FK spójne i z powrotem egzekwowane.
  assert.equal(db.prepare('SELECT nip FROM users WHERE id = ?').get('u1').nip, '123');
  db.prepare('INSERT INTO users (id, nip) VALUES (?, NULL)').run('u2');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'FK muszą być spójne po przebudowie');
  assert.throws(
    () => db.prepare('INSERT INTO matches VALUES (?, ?)').run('m2', 'nie-ma-usera'),
    /FOREIGN KEY/i,
    'egzekwowanie FK musi wrócić po migracji',
  );
  db.close();
});

test('runMigrations — migracja psująca spójność FK jest wycofywana', () => {
  const db = freshDb();
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE matches (id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id));
    INSERT INTO users VALUES ('u1');
    INSERT INTO matches VALUES ('m1', 'u1');
  `);
  // Migracja kasuje rodzica, zostawiając sierotę w matches.
  const dir = migrationsDir({ '001_psuje.sql': "DELETE FROM users WHERE id = 'u1';" });

  assert.throws(() => runMigrations(db, dir), /spójność|foreign key/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'zmiana wycofana');
  assert.deepEqual(appliedMigrations(db), []);
  db.close();
});

test('stampMigrations — zapisuje migracje jako zastosowane BEZ ich wykonywania', () => {
  // Świeża baza dostaje aktualny schema.sql (już po wszystkich zmianach), więc
  // odtwarzanie na niej starych migracji byłoby błędem — przebudowa tabeli
  // cofnęłaby ją do historycznego kształtu. Stempel: zapisz, nie wykonuj.
  const db = freshDb();
  const dir = migrationsDir({
    '001_przebudowa.sql': 'DROP TABLE nie_istnieje_i_nie_moze_byc_wykonana;',
  });

  const result = stampMigrations(db, dir);

  assert.deepEqual(result.stamped, ['001_przebudowa']);
  assert.deepEqual(appliedMigrations(db), ['001_przebudowa']);
  // Kolejny runMigrations traktuje ostemplowaną migrację jako zastosowaną.
  assert.deepEqual(runMigrations(db, dir).applied, []);
  db.close();
});

test('runMigrations — ignoruje pliki, które nie są migracjami .sql', () => {
  const db = freshDb();
  const dir = migrationsDir({
    '001_ok.sql': 'CREATE TABLE ok (id INTEGER);',
    'README.md': 'to nie jest migracja',
    'notatka.txt': 'ani to',
  });
  assert.deepEqual(runMigrations(db, dir).applied, ['001_ok']);
  db.close();
});
