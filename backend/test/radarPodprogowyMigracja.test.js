import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Weryfikacja migracji 009 (model radaru zamówień podprogowych) w IZOLACJI: sam
 * plik .sql na czystej bazie in-memory. Celowo NIE puszczamy go przez pełne
 * `migrate()` — tamta ścieżka odtwarza też cudze, niezacommitowane migracje
 * (005 „prog"), które padają niezależnie od tej pracy. Tu sprawdzamy WYŁĄCZNIE:
 * czy 009 tworzy właściwy kształt (tabele, domyślne wartości, więzy).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRACJA = path.join(__dirname, '..', 'src', 'db', 'migrations', '009_radar_podprogowy.sql');

let db;
before(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  // Minimalna tabela users — preferencje mają do niej klucz obcy.
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  db.exec(fs.readFileSync(MIGRACJA, 'utf8'));
});
after(() => db.close());

test('009: powstają obie tabele radaru podprogowego', () => {
  for (const t of ['zamowienia_podprogowe', 'preferencje_radaru_podprogowego']) {
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t),
      `migracja 009 tworzy tabelę ${t}`,
    );
  }
});

test('009: znalezisko zapisuje się z domyślnymi wartościami', () => {
  db.prepare(`INSERT INTO zamowienia_podprogowe (id, zrodlo, tytul, hash_dedup, created_at, updated_at)
              VALUES ('z1', 'bip', 'Dostawa materiałów biurowych', 'h-1', '2026-07-27', '2026-07-27')`).run();
  const r = db.prepare('SELECT * FROM zamowienia_podprogowe WHERE id = ?').get('z1');
  assert.equal(r.waluta, 'PLN', 'domyślna waluta PLN');
  assert.equal(r.latwiejszy_start, 0, 'domyślnie NIE „łatwiejszy start"');
  assert.equal(r.flagi, '{}', 'domyślne flagi = pusty obiekt JSON');
});

test('009: hash_dedup jest UNIQUE (dedup ogłoszeń między źródłami)', () => {
  db.prepare(`INSERT INTO zamowienia_podprogowe (id, zrodlo, tytul, hash_dedup, created_at, updated_at)
              VALUES ('z2', 'platformazakupowa', 'X', 'dup', 'd', 'd')`).run();
  assert.throws(
    () => db.prepare(`INSERT INTO zamowienia_podprogowe (id, zrodlo, tytul, hash_dedup, created_at, updated_at)
                      VALUES ('z3', 'bip', 'Y', 'dup', 'd', 'd')`).run(),
    /UNIQUE/,
    'ten sam hash_dedup nie może się powtórzyć',
  );
});

test('009: CHECK ogranicza zrodlo do dozwolonych źródeł', () => {
  assert.throws(
    () => db.prepare(`INSERT INTO zamowienia_podprogowe (id, zrodlo, tytul, hash_dedup, created_at, updated_at)
                      VALUES ('z4', 'facebook', 'Z', 'h-4', 'd', 'd')`).run(),
    /CHECK/,
    'nieznane źródło odrzucone',
  );
});

test('009: preferencja radaru ma domyślny próg 170 000 i FK do users', () => {
  db.prepare('INSERT INTO users (id) VALUES (?)').run('u1');
  db.prepare(`INSERT INTO preferencje_radaru_podprogowego (id, user_id, branza, region, created_at, updated_at)
              VALUES ('p1', 'u1', 'sprzątanie', 'mazowieckie', 'd', 'd')`).run();
  const p = db.prepare('SELECT prog_netto FROM preferencje_radaru_podprogowego WHERE id = ?').get('p1');
  assert.equal(p.prog_netto, 170000, 'domyślny próg = 170 000 zł netto (stan progu od 1.01.2026)');
});

test('009: preferencja bez istniejącego usera łamie FK', () => {
  assert.throws(
    () => db.prepare(`INSERT INTO preferencje_radaru_podprogowego (id, user_id, created_at, updated_at)
                      VALUES ('p2', 'brak-usera', 'd', 'd')`).run(),
    /FOREIGN KEY/,
    'preferencja musi wskazywać istniejącego użytkownika',
  );
});
