import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/*
 * Feedback usera (2026-07-09, test APK na telefonie): rejestracja NIE może
 * wymagać NIP-u. Zbieżne z §7 planu migracji (persona JDG zakłada konto zanim
 * w ogóle wie, czy chce podawać dane firmy).
 *
 * Ten plik testuje PEŁNĄ ścieżkę aktualizacji produkcji:
 *  1. baza w STARYM kształcie (company_nip NOT NULL UNIQUE) z danymi i FK,
 *  2. migrate() → migracja 001 przebudowuje users bez utraty danych,
 *  3. trasa POST /auth/register przyjmuje rejestrację bez NIP-u,
 *     a NIP podany dobrowolnie nadal jest walidowany i unikalny.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-nonip-test-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = ''; // rejestracja wysyła mail powitalny — w testach wyłączony

// Stary kształt bazy — dokładnie to, co stoi dziś na produkcji.
{
  const legacy = new DatabaseSync(DB_FILE);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      company_nip TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      premium_tier TEXT NOT NULL DEFAULT 'free' CHECK (premium_tier IN ('free', 'standard')),
      keywords TEXT NOT NULL DEFAULT '[]',
      cpv_codes TEXT NOT NULL DEFAULT '[]',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      push_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tenders (
      id TEXT PRIMARY KEY, bzp_external_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      organization TEXT, cpv_main TEXT, budget REAL, currency TEXT NOT NULL DEFAULT 'PLN',
      deadline TEXT, url TEXT, raw_data TEXT NOT NULL DEFAULT '{}', published_at TEXT,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tender_id TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
      match_reasoning TEXT, scorer TEXT NOT NULL DEFAULT 'ai',
      notified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      UNIQUE (user_id, tender_id)
    );
    INSERT INTO users VALUES ('u-stary', '5261040828', 'Stara Firma', 'stary@test.pl',
      'hash', 'free', '["droga"]', '[]', NULL, NULL, NULL, '2026-01-01', '2026-01-01');
    INSERT INTO tenders (id, bzp_external_id, title, fetched_at)
      VALUES ('t1', 'ext-1', 'Budowa drogi', '2026-01-01');
    INSERT INTO matches (id, user_id, tender_id, confidence_score, created_at)
      VALUES ('m1', 'u-stary', 't1', 80, '2026-01-01');
  `);
  legacy.close();
}

const { migrate } = await import('../src/db/migrate.js');
migrate();

const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

before(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(DB_FILE, { force: true });
  fs.rmSync(`${DB_FILE}-wal`, { force: true });
  fs.rmSync(`${DB_FILE}-shm`, { force: true });
});

async function register(body) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ---------------- migracja starej bazy ----------------

test('migracja: stare konto z NIP-em przetrwało przebudowę razem z dopasowaniami', () => {
  const stary = db.prepare('SELECT * FROM users WHERE id = ?').get('u-stary');
  assert.equal(stary.company_nip, '5261040828');
  assert.equal(stary.company_name, 'Stara Firma');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches').get().n, 1, 'FK i dane dzieci nietknięte');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migracja: kolumna company_nip przyjmuje NULL (przebudowa zdjęła NOT NULL)', () => {
  db.prepare(`INSERT INTO users (id, company_nip, company_name, email, password_hash, created_at, updated_at)
              VALUES ('u-null', NULL, NULL, 'null@test.pl', 'hash', '2026-01-01', '2026-01-01')`).run();
  db.prepare("DELETE FROM users WHERE id = 'u-null'").run();
});

// ---------------- trasa rejestracji ----------------

test('POST /auth/register — rejestracja BEZ NIP-u i BEZ nazwy firmy przechodzi', async () => {
  const { status, json } = await register({
    email: 'jdg@test.pl',
    password: 'haslo1234',
    keywords: ['kostka brukowa'],
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.token, 'odpowiedź musi zawierać token sesji');
  assert.equal(json.user.email, 'jdg@test.pl');
});

test('POST /auth/register — NIP podany dobrowolnie nadal jest walidowany', async () => {
  const { status, json } = await register({
    email: 'zlynip@test.pl',
    password: 'haslo1234',
    company_nip: '1234567890', // zła suma kontrolna
  });
  assert.equal(status, 400);
  assert.match(json.error.message, /NIP/i);
});

test('POST /auth/register — poprawny NIP dalej działa i pilnuje unikalności', async () => {
  const pierwszy = await register({
    email: 'znip@test.pl',
    password: 'haslo1234',
    company_nip: '1234563218',
    company_name: 'Firma z NIP-em',
  });
  assert.equal(pierwszy.status, 201, JSON.stringify(pierwszy.json));

  const duplikat = await register({
    email: 'inny@test.pl',
    password: 'haslo1234',
    company_nip: '1234563218',
  });
  assert.equal(duplikat.status, 409, 'ten sam NIP nie może założyć drugiego konta');
});

test('POST /auth/register — dwa konta bez NIP-u nie kolidują (UNIQUE ignoruje NULL-e)', async () => {
  const a = await register({ email: 'beznipa@test.pl', password: 'haslo1234' });
  const b = await register({ email: 'beznipb@test.pl', password: 'haslo1234' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, JSON.stringify(b.json));
});

test('POST /auth/register — hasło krótsze niż 8 znaków odrzucone', async () => {
  const { status } = await register({ email: 'krotkie@test.pl', password: 'krotkie' });
  assert.equal(status, 400);
});
