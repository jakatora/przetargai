import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Radar pytań i zmian SWZ — model danych (podzadanie 1/7 ulepszenia „Radar pytań
 * i odpowiedzi do SWZ").
 *
 * Powstaje SAM MODEL: postępowanie wzięte pod obserwację mechanizmu wyjaśnień SWZ
 * (termin składania ofert + data ogłoszenia), lista wersji SWZ (hasz/treść/data),
 * pytania do SWZ (treść, fragment, status: szkic/wysłane/odpowiedziane) oraz
 * publikowane zmiany zamawiającego (data, opis skutku, diff, elementy oferty).
 * Bez logiki analizy — tylko proste zapisy/odczyty (kalkulator terminu, analizator
 * i silnik różnic to dalsze podzadania).
 */

// ── Część 1: kontrakt schematu / migracji (izolowana baza w pamięci) ─────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const mig008 = fs.readFileSync(path.join(MIGRATIONS_DIR, '008_radar_swz.sql'), 'utf8');

const TABELE = ['postepowanie_swz', 'swz_wersja', 'pytania_swz', 'zmiany_swz'];

function freshDb(sql) {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(sql);
  return d;
}

function maTabele(d, nazwa) {
  return Boolean(
    d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(nazwa),
  );
}

test('schema.sql — świeża baza ma wszystkie cztery tabele radaru SWZ', () => {
  const d = freshDb(schemaSql);
  for (const t of TABELE) assert.ok(maTabele(d, t), `tabela ${t} musi być w schema.sql (świeża instalacja)`);
  d.close();
});

test('schema.sql — postepowanie_swz ma pole termin_skladania_ofert', () => {
  const d = freshDb(schemaSql);
  const kolumny = d.prepare('PRAGMA table_info(postepowanie_swz)').all().map((c) => c.name);
  assert.ok(kolumny.includes('termin_skladania_ofert'), 'wymagane pole terminu składania ofert');
  assert.ok(kolumny.includes('data_ogloszenia'), 'data ogłoszenia (baza kalkulatora połowy terminu)');
  d.close();
});

test('migracja 008 — dokłada tabele na ISTNIEJĄCEJ bazie i jest idempotentna', () => {
  // Symulacja działającej produkcji: jest tylko `users` (cel klucza obcego).
  const d = freshDb('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  d.exec(mig008);
  d.exec(mig008); // ponowne zastosowanie nie może się wywrócić (CREATE ... IF NOT EXISTS)
  for (const t of TABELE) assert.ok(maTabele(d, t), `migracja 008 musi utworzyć ${t} na istniejącej bazie`);
  d.close();
});

test('schema — postepowanie_swz.user_id wymusza istnienie użytkownika (FK z kaskadą)', () => {
  const d = freshDb(schemaSql);
  assert.throws(
    () => d.prepare(
      `INSERT INTO postepowanie_swz (id, user_id, nazwa, created_at, updated_at)
       VALUES ('p1', 'widmo', 'Budowa drogi', 't', 't')`,
    ).run(),
    'postępowanie dla nieistniejącego usera musi zostać odrzucone przez klucz obcy',
  );
  d.close();
});

test('schema — kolekcje potomne wymagają istniejącego postępowania (FK)', () => {
  const d = freshDb(schemaSql);
  for (const stmt of [
    `INSERT INTO swz_wersja (id, postepowanie_id, hash, data_publikacji, created_at)
       VALUES ('w1', 'widmo', 'h', 't', 't')`,
    `INSERT INTO pytania_swz (id, postepowanie_id, tresc, created_at, updated_at)
       VALUES ('q1', 'widmo', 'pytanie', 't', 't')`,
    `INSERT INTO zmiany_swz (id, postepowanie_id, data_publikacji, created_at)
       VALUES ('z1', 'widmo', 't', 't')`,
  ]) {
    assert.throws(() => d.prepare(stmt).run(), 'wpis bez istniejącego postępowania musi paść na FK');
  }
  d.close();
});

test('schema — status pytania ograniczony do szkic/wyslane/odpowiedziane (CHECK)', () => {
  const d = freshDb(schemaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  d.prepare(`INSERT INTO postepowanie_swz (id, user_id, nazwa, created_at, updated_at)
             VALUES ('p1','u1','Post',' t','t')`).run();
  assert.throws(
    () => d.prepare(`INSERT INTO pytania_swz (id, postepowanie_id, tresc, status, created_at, updated_at)
                     VALUES ('q1','p1','pyt','byle-co','t','t')`).run(),
    'nieznany status musi zostać odrzucony przez CHECK',
  );
  d.close();
});

test('schema — usunięcie postępowania kaskaduje na wersje/pytania/zmiany', () => {
  const d = freshDb(schemaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  d.prepare("INSERT INTO postepowanie_swz (id, user_id, nazwa, created_at, updated_at) VALUES ('p1','u1','Post','t','t')").run();
  d.prepare("INSERT INTO swz_wersja (id, postepowanie_id, hash, data_publikacji, created_at) VALUES ('w1','p1','h1','t','t')").run();
  d.prepare("INSERT INTO pytania_swz (id, postepowanie_id, tresc, created_at, updated_at) VALUES ('q1','p1','pyt','t','t')").run();
  d.prepare("INSERT INTO zmiany_swz (id, postepowanie_id, data_publikacji, created_at) VALUES ('z1','p1','t','t')").run();

  d.prepare("DELETE FROM postepowanie_swz WHERE id = 'p1'").run();
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM swz_wersja').get().n, 0, 'wersje znikają z postępowaniem');
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM pytania_swz').get().n, 0, 'pytania znikają z postępowaniem');
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM zmiany_swz').get().n, 0, 'zmiany znikają z postępowaniem');
  assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(), [], 'zero osieroconych wierszy');
  d.close();
});

// ── Część 2: round-trip przez warstwę repos (temp DB + migrate) ──────────────

const DB_FILE = path.join(os.tmpdir(), `przetargai-radar-swz-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { users, postepowaniaSwz, swzWersje, pytaniaSwz, zmianySwz } = await import('../src/db/repos.js');

let userId;

before(() => {
  migrate();
  userId = users.create({
    companyNip: null, companyName: null, email: `radar-${process.pid}@t.pl`, passwordHash: 'h',
  }).id;
});
after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

test('postepowaniaSwz — create zapisuje termin składania ofert i skopuje odczyt do właściciela', () => {
  const p = postepowaniaSwz.create({
    userId,
    nazwa: 'Budowa hali sportowej',
    dataOgloszenia: '2026-07-01T00:00:00.000Z',
    terminSkladaniaOfert: '2026-08-01T10:00:00.000Z',
  });
  assert.ok(p.id, 'rekord dostaje id');
  assert.equal(p.termin_skladania_ofert, '2026-08-01T10:00:00.000Z');
  assert.equal(p.data_ogloszenia, '2026-07-01T00:00:00.000Z');

  const odczyt = postepowaniaSwz.findByIdForUser(p.id, userId);
  assert.equal(odczyt.nazwa, 'Budowa hali sportowej');
  assert.equal(postepowaniaSwz.findByIdForUser(p.id, 'obcy-user'), null, 'inny user nie widzi cudzego postępowania');
});

test('postepowaniaSwz — daty są opcjonalne, setTerminy je uzupełnia', () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Bez dat' });
  assert.equal(p.termin_skladania_ofert, null);
  assert.equal(p.data_ogloszenia, null);
  const po = postepowaniaSwz.setTerminy(p.id, {
    dataOgloszenia: '2026-09-01T00:00:00.000Z',
    terminSkladaniaOfert: '2026-10-01T00:00:00.000Z',
  });
  assert.equal(po.termin_skladania_ofert, '2026-10-01T00:00:00.000Z');
  assert.equal(po.data_ogloszenia, '2026-09-01T00:00:00.000Z');
});

test('postepowaniaSwz — listForUser zwraca tylko postępowania właściciela', () => {
  const inny = users.create({
    companyNip: null, companyName: null, email: `radar-inny-${process.pid}@t.pl`, passwordHash: 'h',
  }).id;
  postepowaniaSwz.create({ userId: inny, nazwa: 'Cudze' });
  const moje = postepowaniaSwz.listForUser(userId);
  assert.ok(moje.length >= 2, 'widzę swoje postępowania z poprzednich testów');
  assert.ok(moje.every((p) => p.nazwa !== 'Cudze'), 'nie widzę cudzego postępowania');
});

test('swzWersje — add numeruje kolejne wersje i deduplikuje po haszu', () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Wersjonowane' });
  const w1 = swzWersje.add({ postepowanieId: p.id, hash: 'aaa', tresc: 'SWZ v1', dataPublikacji: '2026-07-02T00:00:00.000Z' });
  assert.equal(w1.created, true);
  assert.equal(w1.wersja.numer, 1);

  const w2 = swzWersje.add({ postepowanieId: p.id, hash: 'bbb', sciezka: '/swz/v2.pdf', dataPublikacji: '2026-07-10T00:00:00.000Z' });
  assert.equal(w2.created, true);
  assert.equal(w2.wersja.numer, 2, 'druga wersja dostaje kolejny numer');
  assert.equal(w2.wersja.sciezka, '/swz/v2.pdf');

  // Ten sam hasz co v1 → dedup, brak nowej wersji.
  const w1b = swzWersje.add({ postepowanieId: p.id, hash: 'aaa', tresc: 'SWZ v1' });
  assert.equal(w1b.created, false, 'ten sam hasz nie tworzy duplikatu');
  assert.equal(w1b.wersja.id, w1.wersja.id);

  assert.equal(swzWersje.count(p.id), 2, 'wciąż tylko dwie wersje');
  assert.equal(swzWersje.latestForPostepowanie(p.id).numer, 2);
  const lista = swzWersje.listForPostepowanie(p.id);
  assert.deepEqual(lista.map((w) => w.numer), [1, 2], 'lista rosnąco po numerze');
});

test('pytaniaSwz — create/status prowadzi cykl życia szkic → wysłane → odpowiedziane', () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Z pytaniami' });
  const q = pytaniaSwz.create({
    postepowanieId: p.id,
    tresc: 'Czy dopuszczają Państwo materiał równoważny?',
    fragmentSwz: 'Rozdział III pkt 2.4 — wymóg producenta X',
  });
  assert.equal(q.status, 'szkic', 'nowe pytanie jest szkicem');
  assert.equal(q.fragment_swz, 'Rozdział III pkt 2.4 — wymóg producenta X');

  const wyslane = pytaniaSwz.setStatus(q.id, 'wyslane');
  assert.equal(wyslane.status, 'wyslane');
  const odp = pytaniaSwz.setStatus(q.id, 'odpowiedziane');
  assert.equal(odp.status, 'odpowiedziane');

  assert.throws(() => pytaniaSwz.setStatus(q.id, 'byle-co'), 'nieznany status odrzucony na wejściu');
  assert.throws(() => pytaniaSwz.create({ postepowanieId: p.id, tresc: 'x', status: 'nope' }));

  const lista = pytaniaSwz.listForPostepowanie(p.id);
  assert.equal(lista.length, 1);
});

test('zmianySwz — create zapisuje opis skutku, diff i elementy oferty (JSON round-trip)', () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Ze zmianami' });
  const w = swzWersje.add({ postepowanieId: p.id, hash: 'ver-x', tresc: 'nowa treść' });
  const z = zmianySwz.create({
    postepowanieId: p.id,
    wersjaSwzId: w.wersja.id,
    dataPublikacji: '2026-07-20T00:00:00.000Z',
    opisSkutku: 'termin realizacji 60→45 dni — przelicz harmonogram i cenę',
    diff: '- 60 dni\n+ 45 dni',
    elementyOferty: ['harmonogram', 'cena'],
  });
  assert.deepEqual(z.elementy_oferty, ['harmonogram', 'cena'], 'lista elementów wraca jako tablica');
  assert.equal(z.opis_skutku, 'termin realizacji 60→45 dni — przelicz harmonogram i cenę');
  assert.equal(z.wersja_swz_id, w.wersja.id);

  const odczyt = zmianySwz.findById(z.id);
  assert.deepEqual(odczyt.elementy_oferty, ['harmonogram', 'cena']);

  // Domyślnie pusta lista elementów.
  const z2 = zmianySwz.create({ postepowanieId: p.id, dataPublikacji: '2026-07-21T00:00:00.000Z' });
  assert.deepEqual(z2.elementy_oferty, []);

  const lista = zmianySwz.listForPostepowanie(p.id);
  assert.equal(lista.length, 2);
  assert.ok(lista.every((row) => Array.isArray(row.elementy_oferty)), 'elementy_oferty zawsze tablica');
});
