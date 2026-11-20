import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/migrator.js';

test('018 uzupełnia istniejące rekordy bez utraty treści i nie powtarza ALTER TABLE', () => {
  const db = new DatabaseSync(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swz-migration-018-'));
  const name = '018_swz_zrodla.sql';
  try {
    db.exec(`CREATE TABLE swz_wersja(id TEXT PRIMARY KEY, tresc TEXT);
      CREATE TABLE swz_tresc_wklejona(postepowanie_id TEXT PRIMARY KEY, tresc TEXT, strony TEXT);
      CREATE TABLE pytania_swz(id TEXT PRIMARY KEY, tresc TEXT);
      CREATE TABLE zmiany_swz(id TEXT PRIMARY KEY, diff TEXT);
      CREATE TABLE fitter_safety(id TEXT PRIMARY KEY, payload TEXT);
      INSERT INTO swz_wersja VALUES('v1','SWZ istniejąca');
      INSERT INTO swz_tresc_wklejona VALUES('p1','Analiza istniejąca','[0]');
      INSERT INTO pytania_swz VALUES('q1','Pytanie istniejące');
      INSERT INTO zmiany_swz VALUES('z1','- 60\n+ 45');
      INSERT INTO fitter_safety VALUES('f1','nie zmieniać');`);
    fs.copyFileSync(fileURLToPath(new URL('../src/db/migrations/' + name, import.meta.url)), path.join(dir, name));
    assert.equal(runMigrations(db, dir).applied.length, 1);
    assert.equal(db.prepare('SELECT tresc FROM swz_wersja').get().tresc, 'SWZ istniejąca');
    assert.equal(db.prepare('SELECT strony FROM swz_wersja').get().strony, null);
    assert.equal(db.prepare('SELECT strony FROM swz_tresc_wklejona').get().strony, '[0]');
    assert.equal(db.prepare('SELECT zrodlo FROM pytania_swz').get().zrodlo, null);
    assert.equal(db.prepare('SELECT diff FROM zmiany_swz').get().diff, '- 60\n+ 45');
    assert.equal(db.prepare('SELECT payload FROM fitter_safety').get().payload, 'nie zmieniać');
    assert.equal(runMigrations(db, dir).applied.length, 0);
  } finally { db.close(); fs.unlinkSync(path.join(dir, name)); fs.rmdirSync(dir); }
});
