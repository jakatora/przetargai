import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpointy ZASILAJĄCE PANEL UI „Radar SWZ" (ulepszenie „Radar pytań i odpowiedzi
 * do SWZ", podzadanie 7/7). Panel woła trzy nowe trasy read/write radaru:
 *   • POST /postepowania          — założenie obserwowanego postępowania (wejście),
 *   • GET  /postepowania          — lista ze skrótem (odliczanie + liczby),
 *   • GET  /postepowania/:id       — agregat: meta + termin pytań + pytania +
 *                                    timeline zmian + checklista + werdykt bramki.
 *
 * Trasy czytają wyłącznie istniejące repozytoria — bez płatnego AI. Dane pomocnicze
 * (pytania, zmiany) zakładamy wprost przez repo, więc test jest deterministyczny.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-radar-panel-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz, pytaniaSwz, zmianySwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');

let userId;
let token;
let server;
let base;

before(() => {
  migrate();
  userId = users.create({ companyNip: null, companyName: null, email: `panel-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  token = signToken(userId);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function req(method, sciezka, { tok, body } = {}) {
  const res = await fetch(`${base}${sciezka}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── POST /postepowania — wejście panelu ──────────────────────────────────────

test('POST /postepowania — bez tokenu => 401', async () => {
  const { status } = await req('POST', '/api/przetarg/swz/postepowania', { body: { nazwa: 'X' } });
  assert.equal(status, 401);
});

test('POST /postepowania — pusta nazwa => 400', async () => {
  const { status } = await req('POST', '/api/przetarg/swz/postepowania', { tok: token, body: { nazwa: '   ' } });
  assert.equal(status, 400);
});

test('POST /postepowania — niepoprawna data => 400', async () => {
  const { status } = await req('POST', '/api/przetarg/swz/postepowania', {
    tok: token, body: { nazwa: 'Zła data', termin_skladania_ofert: 'wczoraj' },
  });
  assert.equal(status, 400);
});

test('POST /postepowania — zakłada postępowanie z datami => 201', async () => {
  const { status, json } = await req('POST', '/api/przetarg/swz/postepowania', {
    tok: token,
    body: {
      nazwa: 'Budowa drogi gminnej',
      data_ogloszenia: '2026-01-01T00:00:00.000Z',
      termin_skladania_ofert: '2026-01-11T10:00:00.000Z',
    },
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.postepowanie.id, 'zwraca zapisany rekord z id');
  assert.equal(json.postepowanie.nazwa, 'Budowa drogi gminnej');
  assert.equal(json.postepowanie.termin_skladania_ofert, '2026-01-11T10:00:00.000Z');
});

// ── GET /postepowania — lista skopowana do usera ─────────────────────────────

test('GET /postepowania — widzi tylko swoje postępowania, ze skrótem', async () => {
  const obcy = users.create({ companyNip: null, companyName: null, email: `panel-obcy-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  postepowaniaSwz.create({ userId: obcy, nazwa: 'Cudze' });

  const moje = postepowaniaSwz.create({
    userId, nazwa: 'Remont szkoły',
    dataOgloszenia: '2026-02-01T00:00:00.000Z', terminSkladaniaOfert: '2026-02-21T10:00:00.000Z',
  });
  pytaniaSwz.create({ postepowanieId: moje.id, tresc: 'Czy dopuszczacie materiał równoważny?' });
  zmianySwz.create({ postepowanieId: moje.id, opisSkutku: 'termin 60→45 dni', elementyOferty: ['harmonogram'] });

  const { status, json } = await req('GET', '/api/przetarg/swz/postepowania', { tok: token });
  assert.equal(status, 200, JSON.stringify(json));
  assert.ok(Array.isArray(json.postepowania));
  assert.ok(!json.postepowania.some((p) => p.nazwa === 'Cudze'), 'cudze postępowanie nie wycieka');

  const kafelek = json.postepowania.find((p) => p.id === moje.id);
  assert.ok(kafelek, 'moje postępowanie jest na liście');
  assert.equal(kafelek.liczba_pytan, 1);
  assert.equal(kafelek.liczba_zmian, 1);
  assert.equal(kafelek.do_odznaczenia, 1, 'świeża zmiana czeka na uwzględnienie');
  assert.ok(kafelek.termin_pytania.terminPytan, 'skrót niesie policzony termin pytań');
});

// ── GET /postepowania/:id — agregat panelu ───────────────────────────────────

test('GET /postepowania/:id — cudze/nieistniejące => 404', async () => {
  const obcy = users.create({ companyNip: null, companyName: null, email: `panel-obcy2-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  const cudze = postepowaniaSwz.create({ userId: obcy, nazwa: 'Nie moje' }).id;
  assert.equal((await req('GET', `/api/przetarg/swz/postepowania/${cudze}`, { tok: token })).status, 404);
  assert.equal((await req('GET', '/api/przetarg/swz/postepowania/widmo', { tok: token })).status, 404);
});

test('GET /postepowania/:id — agregat: termin pytań + pytania + timeline + checklista + bramka', async () => {
  const p = postepowaniaSwz.create({
    userId, nazwa: 'Dostawa sprzętu',
    dataOgloszenia: '2026-01-01T00:00:00.000Z', terminSkladaniaOfert: '2026-01-11T10:00:00.000Z',
  });
  pytaniaSwz.create({ postepowanieId: p.id, tresc: 'Doprecyzujcie klasę energetyczną.', fragmentSwz: 'Rozdz. III pkt 2', status: 'szkic' });
  pytaniaSwz.create({ postepowanieId: p.id, tresc: 'Czy wymagany serwis 24h?', status: 'wyslane' });
  const zmiana = zmianySwz.create({
    postepowanieId: p.id,
    opisSkutku: 'termin realizacji 60→45 dni — przelicz harmonogram i cenę',
    diff: '-Termin realizacji: 60 dni\n+Termin realizacji: 45 dni',
    elementyOferty: ['harmonogram', 'cena'],
  });

  const { status, json } = await req('GET', `/api/przetarg/swz/postepowania/${p.id}`, { tok: token });
  assert.equal(status, 200, JSON.stringify(json));

  // Meta + termin pytań (koniec dnia połowy okna 01-01…01-11 => 06.01).
  assert.equal(json.postepowanie.nazwa, 'Dostawa sprzętu');
  assert.ok(json.termin_pytania.terminPytan?.startsWith('2026-01-06'), 'termin pytań = koniec dnia połowy okna');

  // Pytania (obie, w kolejności zapisu) z fragmentem i statusem.
  assert.equal(json.pytania.length, 2);
  assert.equal(json.pytania[0].fragment_swz, 'Rozdz. III pkt 2');
  assert.equal(json.pytania[1].status, 'wyslane');

  // Timeline zmian z diffem, opisem skutku i sekcjami oferty.
  assert.equal(json.zmiany.length, 1);
  assert.match(json.zmiany[0].diff, /45 dni/);
  assert.deepEqual(json.zmiany[0].elementy_oferty, ['harmonogram', 'cena']);
  assert.equal(json.zmiany[0].uwzglednione, false);

  // Checklista + bramka: świeża zmiana blokuje wysyłkę.
  assert.equal(json.checklista.do_odznaczenia, 1);
  assert.equal(json.bramka.dopuszczona, false);
  assert.equal(json.bramka.poziom, 'blokada');

  // Po odznaczeniu (uwzględnieniu) — bramka przepuszcza.
  await req('POST', `/api/przetarg/swz/postepowania/${p.id}/zmiany/${zmiana.id}/uwzglednij`, { tok: token });
  const po = await req('GET', `/api/przetarg/swz/postepowania/${p.id}`, { tok: token });
  assert.equal(po.json.checklista.do_odznaczenia, 0);
  assert.equal(po.json.bramka.dopuszczona, true);
  assert.equal(po.json.bramka.poziom, 'ok');
});
