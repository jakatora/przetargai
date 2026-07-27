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
const { stripeEvents, umowyMonitorowane, postepowaniaSwz, swzWersje, pytaniaSwz, zmianySwz } =
  await import('../src/db/repos.js');

after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

test('migracja: na istniejącej bazie wykonują się WSZYSTKIE migracje po kolei', () => {
  assert.deepEqual(zastosowane.applied, [
    '001_users_nip_opcjonalny',
    '002_stripe_events',
    '003_ai_quota_device',
    '004_umowa_monitorowana',
    '005_umowa_prog_i_alarm',
    '006_rozstrzygniecia_historyczne',
    '007_rozstrzygniecia_indeks_cpv_region',
    '008_radar_swz',
    '009_radar_podprogowy',
    '010_sejf_dokumenty',
    '011_czarna_skrzynka',
    '012_password_resets',
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

test('migracja 004: monitoring umowy działa po aktualizacji (branża + wskaźnik bazowy GUS)', () => {
  // Płacący klient bierze podpisaną umowę pod monitoring waloryzacji na
  // zmigrowanej produkcji — rekord zapisuje się i czyta po właścicielu.
  const zapis = umowyMonitorowane.create({
    userId: 'u-platny', branza: 'budownictwo', wskaznikBazowy: 112.4, wskaznikOkres: '2026-Q2',
  });
  const odczyt = umowyMonitorowane.findByIdForUser(zapis.id, 'u-platny');
  assert.equal(odczyt.branza, 'budownictwo');
  assert.equal(odczyt.wskaznik_bazowy, 112.4);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'FK do users spójne');
});

test('migracja 005: próg + alarm waloryzacji działają po aktualizacji', () => {
  // Płacący klient bierze umowę pod monitoring Z PROGIEM, na zmigrowanej produkcji.
  const umowa = umowyMonitorowane.create({
    userId: 'u-platny', branza: 'budownictwo', wskaznikBazowy: 100, prog: 10,
  });
  assert.equal(umowa.prog, 10, 'kolumna prog zapisuje się po migracji 005');
  assert.equal(umowa.alarm_wyslany, 0, 'domyślnie alarm niewysłany');

  // Rekord z progiem trafia do puli joba; zapis wskaźnika i oznaczenie alarmu działają.
  assert.ok(umowyMonitorowane.doSprawdzenia().some((r) => r.id === umowa.id), 'rekord z progiem jest w puli do sprawdzenia');
  umowyMonitorowane.zapiszWskaznik(umowa.id, 115, '2026');
  umowyMonitorowane.oznaczAlarmWyslany(umowa.id);
  const po = umowyMonitorowane.findByIdForUser(umowa.id, 'u-platny');
  assert.equal(po.wskaznik_aktualny, 115);
  assert.equal(po.alarm_wyslany, 1, 'po oznaczeniu wypada z puli (dedupe)');
  assert.ok(!umowyMonitorowane.doSprawdzenia().some((r) => r.id === umowa.id));
});

test('migracja 006: baza „zwiadu cenowego" (rozstrzygniecie_historyczne) powstaje na produkcji', () => {
  const t = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='rozstrzygniecie_historyczne'",
  ).get();
  assert.ok(t, 'migracja 006 dokłada tabelę rozstrzygnięć historycznych na zmigrowanej bazie');
  // Dane referencyjne (bez FK do users) — wpis nie wymaga istniejącego konta.
  db.prepare(
    `INSERT INTO rozstrzygniecie_historyczne
       (id, kod_cpv, cena_zwycieska, ceny_ofert, data_rozstrzygniecia, status, fetched_at)
     VALUES ('rh1', '45233120-6', 1230000, '[1230000,1450000]', '2026-06-01', 'rozstrzygniete', '2026-07-26')`,
  ).run();
  const row = db.prepare('SELECT status, cena_zwycieska FROM rozstrzygniecie_historyczne WHERE id = ?').get('rh1');
  assert.equal(row.status, 'rozstrzygniete');
  assert.equal(row.cena_zwycieska, 1230000);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'zero osieroconych wierszy po 006');
});

test('migracja 007: złożony indeks (kod CPV + region) powstaje na zmigrowanej produkcji', () => {
  // Rdzeń zwiadu cenowego pyta „za ile wygrywano PODOBNE zamówienia?" —
  // ten sam kod CPV w tym samym regionie. Indeks złożony musi istnieć po migracji.
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_rozstrz_cpv_region'",
  ).get();
  assert.ok(idx, 'migracja 007 dokłada złożony indeks idx_rozstrz_cpv_region');
  // Kolejność kolumn ma znaczenie: wiodący kod CPV, potem region NUTS.
  const kolumny = db.prepare('PRAGMA index_info(idx_rozstrz_cpv_region)').all().map((c) => c.name);
  assert.deepEqual(kolumny, ['kod_cpv', 'region_nuts'], 'indeks wiedzie kodem CPV, potem regionem');
});

test('migracja 008: radar SWZ (postępowanie + wersje + pytania + zmiany) działa na produkcji', () => {
  // Cztery nowe tabele muszą powstać na zmigrowanej produkcji.
  for (const t of ['postepowanie_swz', 'swz_wersja', 'pytania_swz', 'zmiany_swz']) {
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t),
      `migracja 008 dokłada tabelę ${t} na zmigrowanej bazie`,
    );
  }
  // Płacący klient bierze postępowanie pod radar SWZ — pełny round-trip przez repos.
  const p = postepowaniaSwz.create({
    userId: 'u-platny', nazwa: 'Modernizacja oczyszczalni',
    terminSkladaniaOfert: '2026-08-15T10:00:00.000Z',
  });
  assert.equal(p.termin_skladania_ofert, '2026-08-15T10:00:00.000Z');

  const w = swzWersje.add({ postepowanieId: p.id, hash: 'h1', tresc: 'SWZ v1', dataPublikacji: '2026-07-01' });
  assert.equal(w.created, true);
  const q = pytaniaSwz.create({ postepowanieId: p.id, tresc: 'Pytanie?', fragmentSwz: 'pkt 2.1' });
  assert.equal(q.status, 'szkic');
  const z = zmianySwz.create({
    postepowanieId: p.id, wersjaSwzId: w.wersja.id, dataPublikacji: '2026-07-05',
    opisSkutku: 'zmiana terminu', elementyOferty: ['harmonogram'],
  });
  assert.deepEqual(z.elementy_oferty, ['harmonogram']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'FK radaru SWZ spójne');
});

test('migracja 009: radar zamówień podprogowych (feed + preferencje) powstaje na produkcji', () => {
  // Dwie nowe tabele modelu radaru podprogowego muszą powstać na zmigrowanej produkcji.
  for (const t of ['zamowienia_podprogowe', 'preferencje_radaru_podprogowego']) {
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t),
      `migracja 009 dokłada tabelę ${t} na zmigrowanej bazie`,
    );
  }
  // Preferencja płacącego klienta: domyślny próg 170 000 zł, FK do users spójne.
  db.prepare(`INSERT INTO preferencje_radaru_podprogowego (id, user_id, branza, region, created_at, updated_at)
              VALUES ('pref-1', 'u-platny', 'sprzątanie', 'mazowieckie', '2026-07-27', '2026-07-27')`).run();
  const pref = db.prepare('SELECT prog_netto FROM preferencje_radaru_podprogowego WHERE id = ?').get('pref-1');
  assert.equal(pref.prog_netto, 170000, 'domyślny próg = 170 000 zł netto');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'FK radaru podprogowego spójne');
});

test('migracja: ponowne uruchomienie niczego nie zmienia (idempotencja)', () => {
  const drugie = migrate();
  assert.deepEqual(drugie.applied, []);
  assert.equal(drugie.skipped, 12); // 12 migracji (001–012) — wszystkie już zastosowane
});
