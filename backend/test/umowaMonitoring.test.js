import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Monitoring umowy pod kątem waloryzacji — model + zapis (podzadanie 10/12
 * ulepszenia „pilnowanie waloryzacji i pułapek w umowie").
 *
 * W momencie podpisania umowy zapisujemy DWA fakty, które są bazą całego
 * późniejszego pilnowania waloryzacji (podzadania 11–12: śledzenie wskaźników
 * GUS, alarm po przekroczeniu progu, wniosek o waloryzację):
 *   • `branza` kontraktu — po niej dobierany jest właściwy wskaźnik cen GUS,
 *   • `wskaznik_bazowy` — wartość wskaźnika GUS w chwili podpisania (punkt
 *     odniesienia; wzrost cen liczy się jako stosunek późniejszego wskaźnika
 *     do tej bazy).
 *
 * Rekord należy do ZALOGOWANEGO użytkownika (to jego trzeba będzie zaalarmować),
 * więc trasa wymaga tokenu i skopuje odczyt do właściciela.
 */

// ── Część 1: kontrakt schematu / migracji (izolowana baza w pamięci) ─────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const mig004 = fs.readFileSync(path.join(MIGRATIONS_DIR, '004_umowa_monitorowana.sql'), 'utf8');

function freshDb(sql) {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(sql);
  return d;
}

test('schema.sql — świeża baza ma tabelę umowa_monitorowana', () => {
  const d = freshDb(schemaSql);
  const t = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='umowa_monitorowana'",
  ).get();
  assert.ok(t, 'tabela umowa_monitorowana musi być w schema.sql (świeża instalacja)');
  d.close();
});

test('migracja 004 — dokłada tabelę na ISTNIEJĄCEJ bazie i jest idempotentna', () => {
  // Symulacja działającej produkcji: jest tylko `users` (cel klucza obcego).
  const d = freshDb(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);`);
  d.exec(mig004);
  d.exec(mig004); // ponowne zastosowanie nie może się wywrócić (CREATE ... IF NOT EXISTS)
  const t = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='umowa_monitorowana'",
  ).get();
  assert.ok(t, 'migracja 004 musi utworzyć tabelę na istniejącej bazie');
  d.close();
});

test('schema — umowa_monitorowana.user_id wymusza istnienie użytkownika (FK, gotowe pod kaskadę)', () => {
  const d = freshDb(schemaSql);
  assert.throws(
    () => d.prepare(
      `INSERT INTO umowa_monitorowana (id, user_id, branza, wskaznik_bazowy, data_podpisania, created_at, updated_at)
       VALUES ('u1', 'widmo', 'budownictwo', 112.4, 't', 't', 't')`,
    ).run(),
    'wpis dla nieistniejącego usera musi zostać odrzucony przez klucz obcy',
  );
  d.close();
});

// ── Część 2: endpoint zapisu (pełna aplikacja) ───────────────────────────────

const DB_FILE = path.join(os.tmpdir(), `przetargai-umowa-mon-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

before(() => {
  migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function zaloz(email) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'haslo12345', keywords: ['budownictwo'] }),
  });
  return (await res.json()).token;
}

async function monitoruj(token, body) {
  const res = await fetch(`${base}/api/przetarg/umowa/monitoruj`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function listaMonitorowanych(token) {
  const res = await fetch(`${base}/api/przetarg/umowa/monitoruj`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: await res.json() };
}

test('POST /monitoruj — bez tokenu => 401', async () => {
  const { status } = await monitoruj(null, { branza: 'budownictwo', wskaznik_bazowy: 112.4 });
  assert.equal(status, 401);
});

test('POST /monitoruj — zapisuje branżę i wskaźnik bazowy, zwraca 201 z rekordem', async () => {
  const token = await zaloz(`zapis-${process.pid}@t.pl`);
  const { status, json } = await monitoruj(token, {
    branza: 'budownictwo',
    wskaznik_bazowy: 112.4,
    wskaznik_okres: '2026-Q2',
    data_podpisania: '2026-07-25T00:00:00.000Z',
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.umowa?.id, 'rekord dostaje id');
  assert.equal(json.umowa.branza, 'budownictwo');
  assert.equal(json.umowa.wskaznik_bazowy, 112.4);
  assert.equal(json.umowa.wskaznik_okres, '2026-Q2');
  assert.equal(json.umowa.data_podpisania, '2026-07-25T00:00:00.000Z');

  // Faktycznie trafiło do tabeli (nie tylko echo z handlera).
  const wiersz = db.prepare('SELECT branza, wskaznik_bazowy FROM umowa_monitorowana WHERE id = ?')
    .get(json.umowa.id);
  assert.equal(wiersz.branza, 'budownictwo');
  assert.equal(wiersz.wskaznik_bazowy, 112.4);
});

test('POST /monitoruj — bez daty podpisania stempluje moment zapisu; okres opcjonalny', async () => {
  const token = await zaloz(`domyslne-${process.pid}@t.pl`);
  const przed = Date.now();
  const { status, json } = await monitoruj(token, { branza: 'transport', wskaznik_bazowy: 105 });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.umowa.wskaznik_okres, null, 'brak okresu => null');
  const stempel = Date.parse(json.umowa.data_podpisania);
  assert.ok(!Number.isNaN(stempel), 'data_podpisania to poprawna data ISO');
  assert.ok(stempel >= przed - 1000, 'domyślna data to „teraz"');
});

test('POST /monitoruj — brak branży => 400', async () => {
  const token = await zaloz(`bezbranzy-${process.pid}@t.pl`);
  const { status } = await monitoruj(token, { wskaznik_bazowy: 112.4 });
  assert.equal(status, 400);
  const pusta = await monitoruj(token, { branza: '   ', wskaznik_bazowy: 112.4 });
  assert.equal(pusta.status, 400, 'sam biały znak też jest pustą branżą');
});

test('POST /monitoruj — wskaźnik bazowy niedodatni lub nie-liczba => 400', async () => {
  const token = await zaloz(`bezwskaznika-${process.pid}@t.pl`);
  assert.equal((await monitoruj(token, { branza: 'budownictwo' })).status, 400);
  assert.equal((await monitoruj(token, { branza: 'budownictwo', wskaznik_bazowy: 0 })).status, 400);
  assert.equal((await monitoruj(token, { branza: 'budownictwo', wskaznik_bazowy: -3 })).status, 400);
  assert.equal((await monitoruj(token, { branza: 'budownictwo', wskaznik_bazowy: '112' })).status, 400);
});

test('POST /monitoruj — zapisuje opcjonalny próg waloryzacji z umowy (podzadanie 11/12)', async () => {
  const token = await zaloz(`prog-${process.pid}@t.pl`);
  const { status, json } = await monitoruj(token, {
    branza: 'budownictwo', wskaznik_bazowy: 100, prog: 10,
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.umowa.prog, 10);
  assert.equal(json.umowa.alarm_wyslany, 0, 'nowa umowa jeszcze nie alarmowała');

  const wiersz = db.prepare('SELECT prog FROM umowa_monitorowana WHERE id = ?').get(json.umowa.id);
  assert.equal(wiersz.prog, 10);
});

test('POST /monitoruj — bez progu zapisuje null (umowa monitorowana, ale nie alarmuje)', async () => {
  const token = await zaloz(`bezprogu-${process.pid}@t.pl`);
  const { json } = await monitoruj(token, { branza: 'transport', wskaznik_bazowy: 105 });
  assert.equal(json.umowa.prog, null);
});

test('POST /monitoruj — próg poza zakresem (0, 100] => 400', async () => {
  const token = await zaloz(`zlyprog-${process.pid}@t.pl`);
  for (const prog of [0, -5, 150]) {
    const { status } = await monitoruj(token, { branza: 'budownictwo', wskaznik_bazowy: 100, prog });
    assert.equal(status, 400, `prog=${prog} musi zostać odrzucony`);
  }
});

test('GET /monitoruj — zwraca tylko umowy zalogowanego użytkownika', async () => {
  const tokenA = await zaloz(`ownerA-${process.pid}@t.pl`);
  const tokenB = await zaloz(`ownerB-${process.pid}@t.pl`);
  await monitoruj(tokenA, { branza: 'budownictwo', wskaznik_bazowy: 112.4 });
  await monitoruj(tokenA, { branza: 'transport', wskaznik_bazowy: 105 });
  await monitoruj(tokenB, { branza: 'sprzątanie', wskaznik_bazowy: 108 });

  const a = await listaMonitorowanych(tokenA);
  assert.equal(a.status, 200);
  assert.equal(a.json.umowy.length, 2, 'A widzi swoje dwie umowy');
  assert.ok(a.json.umowy.every((u) => u.branza !== 'sprzątanie'), 'A nie widzi umowy B');

  const b = await listaMonitorowanych(tokenB);
  assert.equal(b.json.umowy.length, 1, 'B widzi tylko swoją umowę');
});
