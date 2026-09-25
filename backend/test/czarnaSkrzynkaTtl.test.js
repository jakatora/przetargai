import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Czarna skrzynka — TTL i limit sesji (2026-09-25).
 *
 * Sesja bez wgranej oferty (`hash_oferty IS NULL`) była „otwarta” NA ZAWSZE: monitor
 * dostępności pingował ją co 15 minut do końca świata (append-only log rósł bez końca),
 * a użytkownik mógł otworzyć dowolnie wiele sesji. Teraz sesję pomijamy po 48 h od
 * utworzenia albo po terminie składania ofert (jeśli znany) — co nastąpi wcześniej —
 * i pozwalamy na 5 otwartych sesji na użytkownika (6. => 429).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-cs-ttl-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
const STORAGE_DIR = path.join(os.tmpdir(), `przetargai-cs-ttl-store-${process.pid}`);
process.env.DATABASE_PATH = DB_FILE;
process.env.CZARNA_SKRZYNKA_STORAGE_DIR = STORAGE_DIR;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { createCzarnaSkrzynka, LIMIT_OTWARTYCH_SESJI } = await import('../src/services/czarnaSkrzynka.js');
const { runDostepnoscMonitor } = await import('../src/jobs/dostepnosc-platformy.js');
const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');

function freshDb() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(schemaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u2','c@d.pl','h','t','t')").run();
  return d;
}

const T0 = Date.parse('2026-09-25T10:00:00.000Z');
const GODZ = 3_600_000;
function zegarRuchomy() {
  let ms = T0;
  return {
    teraz: () => new Date(ms).toISOString(),
    strefa: () => 'Europe/Warsaw',
    przesun: (godziny) => { ms += godziny * GODZ; },
  };
}
const magazyn = { async zapisz(id, f) { return `${id}.${f}`; } };

// ══════════════════════════ TTL sesji ═════════════════════════════════════════

test('TTL: sesja bez oferty pingowana do 48 h od utworzenia, potem pomijana', () => {
  const zegar = zegarRuchomy();
  const cs = createCzarnaSkrzynka(freshDb(), { magazynPlikow: magazyn, zegar });
  const s = cs.rozpocznijSesje('u1');
  zegar.przesun(47);
  assert.deepEqual(cs.sesjeOtwarte().map((x) => x.id), [s.id]);
  zegar.przesun(2); // 49 h
  assert.deepEqual(cs.sesjeOtwarte(), [], 'po 48 h sesja wypada z monitora');
});

test('TTL: znany termin składania skraca okno — po terminie ping nie ma sensu', () => {
  const zegar = zegarRuchomy();
  const cs = createCzarnaSkrzynka(freshDb(), { magazynPlikow: magazyn, zegar });
  const s = cs.rozpocznijSesje('u1', { terminSkladania: new Date(T0 + 2 * GODZ).toISOString() });
  assert.equal(s.termin_skladania, new Date(T0 + 2 * GODZ).toISOString(), 'termin utrwalony na sesji');
  zegar.przesun(1);
  assert.equal(cs.sesjeOtwarte().length, 1);
  zegar.przesun(2); // 3 h > termin
  assert.equal(cs.sesjeOtwarte().length, 0);
});

test('TTL: monitor dostępności nie pinguje wygasłych sesji (zero sieci)', async () => {
  const zegar = zegarRuchomy();
  const cs = createCzarnaSkrzynka(freshDb(), { magazynPlikow: magazyn, zegar });
  cs.rozpocznijSesje('u1');
  zegar.przesun(72);
  let pingi = 0;
  const wynik = await runDostepnoscMonitor({ skrzynka: cs, ping: async () => { pingi++; return { dostepna: true, kodHttp: 200, czasMs: 1 }; } });
  assert.equal(wynik.sesje, 0);
  assert.equal(pingi, 0);
});

// ══════════════════════════ Limit sesji ═══════════════════════════════════════

test(`limit: ${'5'} otwartych sesji na użytkownika, kolejna => błąd LIMIT_SESJI`, async () => {
  assert.equal(LIMIT_OTWARTYCH_SESJI, 5);
  const zegar = zegarRuchomy();
  const cs = createCzarnaSkrzynka(freshDb(), { magazynPlikow: magazyn, zegar });
  const sesje = [];
  for (let i = 0; i < 5; i++) sesje.push(cs.rozpocznijSesje('u1'));
  assert.throws(() => cs.rozpocznijSesje('u1'), (e) => e.code === 'LIMIT_SESJI');
  assert.ok(cs.rozpocznijSesje('u2'), 'limit jest per użytkownik');

  // Wgrana oferta zamyka sesję => miejsce się zwalnia.
  await cs.zapiszOferte('u1', sesje[0].id, Buffer.from('oferta').toString('base64'), { nazwaPliku: 'o.pdf' });
  assert.ok(cs.rozpocznijSesje('u1'));
  assert.throws(() => cs.rozpocznijSesje('u1'), (e) => e.code === 'LIMIT_SESJI');

  // Wygasłe (48 h) się nie liczą.
  zegar.przesun(49);
  assert.ok(cs.rozpocznijSesje('u1'));
});

// ══════════════════════════ Trasa ═════════════════════════════════════════════

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
  for (const s of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${DB_FILE}${s}`, { force: true }); } catch { /* Windows */ }
  }
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
});

async function zaloz(email) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'haslo12345' }),
  });
  return (await res.json()).token;
}
async function post(token, url, body) {
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test('POST /sesje: 6. otwarta sesja => 429 z komunikatem po polsku', async () => {
  const token = await zaloz(`cs-limit-${process.pid}@t.pl`);
  for (let i = 0; i < 5; i++) assert.equal((await post(token, '/api/przetarg/czarna-skrzynka/sesje', {})).status, 201);
  const r = await post(token, '/api/przetarg/czarna-skrzynka/sesje', {});
  assert.equal(r.status, 429);
  assert.match(r.json.error.message, /otwartych sesji/i);
});

test('POST /sesje: termin_skladania z body albo z postępowania Radaru SWZ; zła data => 400', async () => {
  const token = await zaloz(`cs-termin-${process.pid}@t.pl`);
  const zBody = await post(token, '/api/przetarg/czarna-skrzynka/sesje', { termin_skladania: '2026-10-01T08:00:00.000Z' });
  assert.equal(zBody.status, 201, JSON.stringify(zBody.json));
  assert.equal(zBody.json.sesja.termin_skladania, '2026-10-01T08:00:00.000Z');

  const p = await post(token, '/api/przetarg/swz/postepowania', { nazwa: 'Hala', termin_skladania_ofert: '2026-10-02T08:00:00.000Z' });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  const zPost = await post(token, '/api/przetarg/czarna-skrzynka/sesje', { postepowanie_id: p.json.postepowanie.id });
  assert.equal(zPost.json.sesja.termin_skladania, '2026-10-02T08:00:00.000Z', 'termin wzięty z postępowania');

  const zla = await post(token, '/api/przetarg/czarna-skrzynka/sesje', { termin_skladania: 'jutro' });
  assert.equal(zla.status, 400);
});
