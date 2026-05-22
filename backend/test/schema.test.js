import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
}

const insertUser = (db, id, nip, email) =>
  db.prepare(`INSERT INTO users
    (id, company_nip, company_name, email, password_hash, keywords, cpv_codes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', '[]', ?, ?)`)
    .run(id, nip, 'Firma', email, 'hash', 't', 't');

test('schema — wszystkie tabele tworzą się bez błędu', () => {
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all().map((r) => r.name);
  for (const t of ['users', 'tenders', 'matches', 'feedback', 'audit_logs', 'ai_usage', 'magic_links']) {
    assert.ok(tables.includes(t), `brakuje tabeli ${t}`);
  }
  db.close();
});

test('schema — UNIQUE wymusza unikalny email użytkownika', () => {
  const db = freshDb();
  insertUser(db, 'u1', '1111111111', 'a@x.pl');
  assert.throws(() => insertUser(db, 'u2', '2222222222', 'a@x.pl'));
  db.close();
});

test('schema — klucz obcy matches.user_id wymaga istnienia użytkownika', () => {
  const db = freshDb();
  assert.throws(() => db.prepare(
    `INSERT INTO matches (id, user_id, tender_id, confidence_score, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('m1', 'ghost', 'ghost', 50, 't'));
  db.close();
});

test('schema — CHECK ogranicza confidence_score do 0-100', () => {
  const db = freshDb();
  insertUser(db, 'u1', '1111111111', 'a@x.pl');
  db.prepare(`INSERT INTO tenders (id, bzp_external_id, title, raw_data, fetched_at)
    VALUES ('t1', 'BZP-1', 'Test', '{}', 't')`).run();
  assert.throws(() => db.prepare(
    `INSERT INTO matches (id, user_id, tender_id, confidence_score, created_at)
     VALUES ('m1', 'u1', 't1', 150, 't')`,
  ).run());
  db.close();
});
