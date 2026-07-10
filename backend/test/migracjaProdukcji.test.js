import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/*
 * Próba generalna aktualizacji PRODUKCJI: odtwarzamy bazę w kształcie sprzed
 * migracji (z danymi płacącego klienta i kluczami obcymi), puszczamy `migrate()`
 * i sprawdzamy, że nic nie przepadło, a nowe funkcje działają.
 *
 * Migracja bazy z klientami to operacja jednokierunkowa — jeżeli ma się wywalić,
 * niech się wywali tutaj, a nie o 3 w nocy na wolumenie Railway.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-prod-mig-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';

// Kształt bazy sprzed migracji 001 i 002 (dokładnie to, co stoi na produkcji).
{
  const stara = new DatabaseSync(DB_FILE);
  stara.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      company_nip TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      premium_tier TEXT NOT NULL DEFAULT 'free' CHECK (premium_tier IN ('free','standard')),
      keywords TEXT NOT NULL DEFAULT '[]',
      cpv_codes TEXT NOT NULL DEFAULT '[]',
      stripe_customer_id TEXT, stripe_subscription_id TEXT, push_token TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
    INSERT INTO users VALUES ('u-platny','5261040828','Klient Płacący','klient@prod.pl',
      'hash','standard','["droga"]','[]','cus_123','sub_123','ExpoToken[x]','2026-01-01','2026-01-01');
    INSERT INTO tenders (id,bzp_external_id,title,fetched_at) VALUES ('t1','ext-1','Budowa drogi','2026-01-01');
    INSERT INTO matches (id,user_id,tender_id,confidence_score,created_at) VALUES ('m1','u-platny','t1',80,'2026-01-01');
  `);
  stara.close();
}

const { migrate } = await import('../src/db/migrate.js');
const zastosowane = migrate();

const { db } = await import('../src/db/index.js');
const { stripeEvents } = await import('../src/db/repos.js');

after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

test('migracja: na istniejącej bazie wykonują się WSZYSTKIE migracje po kolei', () => {
  assert.deepEqual(zastosowane.applied, [
    '001_users_nip_opcjonalny',
    '002_stripe_events',
    '003_ai_quota_device',
  ]);
});

test('migracja: płacący klient przetrwał nietknięty', () => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get('u-platny');
  assert.equal(u.company_nip, '5261040828');
  assert.equal(u.premium_tier, 'standard', 'plan płatny nie może przepaść');
  assert.equal(u.stripe_subscription_id, 'sub_123');
  assert.equal(u.push_token, 'ExpoToken[x]');
  assert.deepEqual(JSON.parse(u.keywords), ['droga']);
});

test('migracja: dopasowania i klucze obce nienaruszone', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches').get().n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'zero osieroconych wierszy');
});

test('migracja 001: rejestracja bez NIP-u działa po aktualizacji', () => {
  db.prepare(`INSERT INTO users (id, company_nip, company_name, email, password_hash, created_at, updated_at)
              VALUES (?, NULL, NULL, ?, ?, ?, ?)`).run('u-nowy', 'bez@nip.pl', 'h', '2026-07-10', '2026-07-10');
  assert.equal(db.prepare('SELECT company_nip FROM users WHERE id = ?').get('u-nowy').company_nip, null);
});

test('migracja 002: rejestr zdarzeń Stripe działa (claim / duplikat / release)', () => {
  assert.equal(stripeEvents.claim('evt_1', 'checkout.session.completed'), true);
  assert.equal(stripeEvents.claim('evt_1', 'checkout.session.completed'), false, 'duplikat odrzucony');
  stripeEvents.release('evt_1');
  assert.equal(stripeEvents.claim('evt_1', 'checkout.session.completed'), true, 'po release ponowienie przechodzi');
});

test('migracja: ponowne uruchomienie niczego nie zmienia (idempotencja)', () => {
  const drugie = migrate();
  assert.deepEqual(drugie.applied, []);
  assert.equal(drugie.skipped, 3);
});
