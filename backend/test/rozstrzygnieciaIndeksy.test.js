import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Indeksy „zwiadu cenowego" — kontrakt migracji 007 (podzadanie 2/15 ulepszenia
 * „Cenowy zwiad: za ile realnie wygrywa się takie przetargi").
 *
 * Zwiad dobiera PODOBNE rozstrzygnięcia po kodzie CPV w tym samym regionie
 * (WHERE kod_cpv = ? AND region_nuts = ?) — stąd indeks złożony wiodący kodem
 * CPV. Osobny indeks po ID zamawiającego istnieje już od migracji 006, więc
 * 007 go NIE dubluje; test pilnuje jednego i drugiego.
 *
 * Dyscyplina projektu (migrator.js): indeks żyje w DWÓCH miejscach — schema.sql
 * (świeże instalacje) i migracji (istniejące bazy). Test sprawdza oba oraz
 * idempotencję migracji.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
const mig006 = fs.readFileSync(path.join(MIGRATIONS_DIR, '006_rozstrzygniecia_historyczne.sql'), 'utf8');
const mig007 = fs.readFileSync(path.join(MIGRATIONS_DIR, '007_rozstrzygniecia_indeks_cpv_region.sql'), 'utf8');

const IDX_ZLOZONY = 'idx_rozstrz_cpv_region';
const IDX_ZAMAWIAJACY = 'idx_rozstrz_zamawiajacy';

function freshDb(sql) {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(sql);
  return d;
}

function indeksy(d) {
  return new Set(
    d.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name),
  );
}

function kolumnyIndeksu(d, nazwa) {
  return d.prepare(`PRAGMA index_info(${nazwa})`).all().map((c) => c.name);
}

test('schema.sql — świeża baza ma złożony indeks (kod CPV + region NUTS)', () => {
  const d = freshDb(schemaSql);
  assert.ok(indeksy(d).has(IDX_ZLOZONY), 'świeża instalacja musi mieć idx_rozstrz_cpv_region');
  assert.deepEqual(
    kolumnyIndeksu(d, IDX_ZLOZONY),
    ['kod_cpv', 'region_nuts'],
    'indeks wiedzie kodem CPV (najbardziej selektywny), potem regionem',
  );
  d.close();
});

test('migracja 007 — dokłada złożony indeks na ISTNIEJĄCEJ bazie i jest idempotentna', () => {
  // Symulacja produkcji: tabela rozstrzygnięć już stoi (z migracji 006).
  const d = freshDb('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  d.exec(mig006);
  assert.ok(!indeksy(d).has(IDX_ZLOZONY), 'przed 007 złożonego indeksu jeszcze nie ma');
  d.exec(mig007);
  d.exec(mig007); // ponowne zastosowanie nie może się wywrócić (CREATE INDEX IF NOT EXISTS)
  assert.ok(indeksy(d).has(IDX_ZLOZONY), 'migracja 007 tworzy idx_rozstrz_cpv_region na istniejącej bazie');
  d.close();
});

test('parytet: schema.sql i 006+007 dają ten sam zestaw indeksów rozstrzygnięć', () => {
  const zeSchema = freshDb(schemaSql);
  const zMigracji = freshDb('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  zMigracji.exec(mig006);
  zMigracji.exec(mig007);
  const tylkoRozstrz = (d) => [...indeksy(d)].filter((n) => n.startsWith('idx_rozstrz_')).sort();
  assert.deepEqual(
    tylkoRozstrz(zeSchema),
    tylkoRozstrz(zMigracji),
    'indeksy rozstrzygnięć w schema.sql i w migracjach muszą być identyczne',
  );
  zeSchema.close();
  zMigracji.close();
});

test('migracja 006 — dostarcza osobny indeks po ID zamawiającego', () => {
  // Osobny indeks po zamawiającym to część opisu podzadania, ale powstał już
  // w 006 — dlatego 007 go NIE dubluje (patrz test niżej).
  const d = freshDb('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  d.exec(mig006);
  assert.ok(indeksy(d).has(IDX_ZAMAWIAJACY), 'osobny indeks po zamawiającym pochodzi z migracji 006');
  d.close();
});

test('migracja 007 — tworzy WYŁĄCZNIE indeks złożony (nie odtwarza istniejących)', () => {
  // Zastosowana na gołej tabeli (bez żadnych indeksów) 007 dokłada dokładnie
  // jeden indeks — złożony. Dowodzi behawioralnie, że nie dubluje niczego z 006.
  const d = freshDb(
    `CREATE TABLE rozstrzygniecie_historyczne (
       id TEXT PRIMARY KEY, kod_cpv TEXT NOT NULL, region_nuts TEXT, zamawiajacy_id TEXT
     );`,
  );
  d.exec(mig007);
  const rozstrz = [...indeksy(d)].filter((n) => n.startsWith('idx_rozstrz_'));
  assert.deepEqual(rozstrz, [IDX_ZLOZONY], 'migracja 007 dokłada tylko idx_rozstrz_cpv_region');
  d.close();
});
