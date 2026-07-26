import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Model „rozstrzygnięcie historyczne" — kontrakt schematu i migracji (podzadanie
 * 1/15 ulepszenia „Cenowy zwiad: za ile realnie wygrywa się takie przetargi").
 *
 * Tabela `rozstrzygniecie_historyczne` trzyma twarde dane z przeszłych
 * rozstrzygnięć (BZP/TED), na których stanie zwiad cenowy: za ile wygrywano
 * podobne zamówienia (kod CPV, region NUTS, skala), rozrzut cen ofert, budżet
 * zamawiającego vs cena zwycięska i kto wygrywa u danego zamawiającego.
 *
 * To sam MODEL — bez logiki pobierania. Test pilnuje więc tylko kontraktu:
 * kolumny, więzy (NOT NULL / CHECK / UNIQUE) oraz parytet schema.sql ⇔ migracja.
 * Dane są WSPÓLNE (referencyjne), więc świadomie NIE ma klucza obcego do users.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const mig006 = fs.readFileSync(path.join(MIGRATIONS_DIR, '006_rozstrzygniecia_historyczne.sql'), 'utf8');

const TABELA = 'rozstrzygniecie_historyczne';

// Kolumny wprost wymagane przez ulepszenie (opis podzadania). Test pilnuje, że
// żadnej nie zgubimy przy przyszłych zmianach modelu.
const WYMAGANE_KOLUMNY = [
  'kod_cpv',              // kod CPV
  'region_nuts',          // region NUTS
  'zamawiajacy_id',       // ID zamawiającego
  'zwyciezca_nazwa',      // nazwa zwycięzcy
  'cena_zwycieska',       // cena zwycięska
  'ceny_ofert',           // lista wszystkich cen ofert
  'budzet_zamawiajacego', // budżet zamawiającego
  'data_rozstrzygniecia', // data
  'wartosc_postepowania', // wartość/skala postępowania
  'status',               // status (rozstrzygnięto / unieważniono)
];

function freshDb(sql) {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(sql);
  return d;
}

function kolumny(d, tabela) {
  return d.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
}

test('schema.sql — świeża baza ma tabelę rozstrzygniecie_historyczne', () => {
  const d = freshDb(schemaSql);
  const t = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(TABELA);
  assert.ok(t, 'tabela rozstrzygniecie_historyczne musi być w schema.sql (świeża instalacja)');
  d.close();
});

test('schema.sql — model ma wszystkie kolumny wymagane przez opis ulepszenia', () => {
  const d = freshDb(schemaSql);
  const kols = new Set(kolumny(d, TABELA));
  for (const k of WYMAGANE_KOLUMNY) {
    assert.ok(kols.has(k), `brakuje kolumny „${k}" wymaganej przez zwiad cenowy`);
  }
  d.close();
});

test('migracja 006 — dokłada tabelę na ISTNIEJĄCEJ bazie i jest idempotentna', () => {
  // Symulacja działającej produkcji: jest tylko `users` (dane referencyjne
  // rozstrzygnięć NIE mają FK do users, więc nic więcej nie jest potrzebne).
  const d = freshDb('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  d.exec(mig006);
  d.exec(mig006); // ponowne zastosowanie nie może się wywrócić (CREATE ... IF NOT EXISTS)
  const t = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(TABELA);
  assert.ok(t, 'migracja 006 musi utworzyć tabelę na istniejącej bazie');
  d.close();
});

test('parytet: schema.sql i migracja 006 dają identyczny zestaw kolumn', () => {
  // Dyscyplina projektu (migrate.js): każda tabela żyje w DWÓCH miejscach —
  // schema.sql (świeże instalacje) i migracji (istniejące bazy). Muszą się zgadzać.
  const zeSchema = freshDb(schemaSql);
  const zMigracji = freshDb('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  zMigracji.exec(mig006);
  assert.deepEqual(
    kolumny(zeSchema, TABELA).sort(),
    kolumny(zMigracji, TABELA).sort(),
    'kolumny w schema.sql i migracji 006 muszą być takie same',
  );
  zeSchema.close();
  zMigracji.close();
});

test('model — zapisuje pełne rozstrzygnięcie (zwycięzca, ceny ofert, budżet)', () => {
  const d = freshDb(schemaSql);
  d.prepare(
    `INSERT INTO ${TABELA}
       (id, external_id, kod_cpv, region_nuts, zamawiajacy_id, zamawiajacy_nazwa,
        zwyciezca_nazwa, cena_zwycieska, ceny_ofert, budzet_zamawiajacego,
        wartosc_postepowania, data_rozstrzygniecia, status, fetched_at)
     VALUES ('r1', 'bzp-1', '45233120-6', 'PL911', '5261040828', 'Miasto X',
             'Firma Drogowa Sp. z o.o.', 1230000.0, '[1230000,1450000,1600000]', 1400000.0,
             1400000.0, '2026-06-01', 'rozstrzygniete', '2026-07-26')`,
  ).run();
  const row = d.prepare(`SELECT * FROM ${TABELA} WHERE id = 'r1'`).get();
  assert.equal(row.kod_cpv, '45233120-6');
  assert.equal(row.cena_zwycieska, 1230000.0);
  assert.deepEqual(JSON.parse(row.ceny_ofert), [1230000, 1450000, 1600000]);
  assert.equal(row.zrodlo, 'bzp', 'domyślne źródło to bzp');
  assert.equal(row.waluta, 'PLN', 'domyślna waluta to PLN');
  d.close();
});

test('model — unieważnione: bez zwycięzcy i bez ceny zwycięskiej', () => {
  const d = freshDb(schemaSql);
  // Unieważnienie nie ma wygranego — kolumny zwycięzcy zostają NULL.
  d.prepare(
    `INSERT INTO ${TABELA}
       (id, kod_cpv, data_rozstrzygniecia, status, fetched_at)
     VALUES ('r2', '90910000-9', '2026-06-10', 'uniewaznione', '2026-07-26')`,
  ).run();
  const row = d.prepare(`SELECT * FROM ${TABELA} WHERE id = 'r2'`).get();
  assert.equal(row.status, 'uniewaznione');
  assert.equal(row.zwyciezca_nazwa, null);
  assert.equal(row.cena_zwycieska, null);
  assert.deepEqual(JSON.parse(row.ceny_ofert), [], 'domyślnie pusta lista ofert');
  d.close();
});

test('model — status spoza słownika jest odrzucany (CHECK)', () => {
  const d = freshDb(schemaSql);
  assert.throws(
    () => d.prepare(
      `INSERT INTO ${TABELA} (id, kod_cpv, data_rozstrzygniecia, status, fetched_at)
       VALUES ('r3', '45000000-7', '2026-06-01', 'w_toku', '2026-07-26')`,
    ).run(),
    'status musi należeć do {rozstrzygniete, uniewaznione}',
  );
  d.close();
});

test('model — brak kodu CPV jest odrzucany (klucz zwiadu, NOT NULL)', () => {
  const d = freshDb(schemaSql);
  assert.throws(
    () => d.prepare(
      `INSERT INTO ${TABELA} (id, data_rozstrzygniecia, status, fetched_at)
       VALUES ('r4', '2026-06-01', 'rozstrzygniete', '2026-07-26')`,
    ).run(),
    'rozstrzygnięcie bez kodu CPV jest bezużyteczne dla zwiadu → NOT NULL',
  );
  d.close();
});

test('model — external_id jest unikalny (idempotentny import)', () => {
  const d = freshDb(schemaSql);
  const ins = (id) => d.prepare(
    `INSERT INTO ${TABELA} (id, external_id, kod_cpv, data_rozstrzygniecia, status, fetched_at)
     VALUES ('${id}', 'bzp-dup', '45000000-7', '2026-06-01', 'rozstrzygniete', '2026-07-26')`,
  ).run();
  ins('r5');
  assert.throws(() => ins('r6'), 'to samo external_id nie może wejść dwa razy (dedup)');
  d.close();
});
