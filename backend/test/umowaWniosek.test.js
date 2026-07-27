import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpoint generatora WNIOSKU O WALORYZACJĘ (podzadanie 12/12 ulepszenia
 * „pilnowanie waloryzacji i pułapek w umowie"). Trasa liczy kwotę z różnicy
 * wskaźników GUS, dobiera podstawę prawną i EKSPORTUJE gotowe pismo do pliku
 * (pobranie jako załącznik). Test jedzie na żywej aplikacji przez HTTP z tokenem
 * właściciela — to dowód „o rzeczywistość" dla ścieżki liczącej należność.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-umowa-wniosek-${process.pid}.db`);
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

async function wniosek(token, body, query = '') {
  const res = await fetch(`${base}/api/przetarg/umowa/wniosek${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function monitoruj(token, body) {
  const res = await fetch(`${base}/api/przetarg/umowa/monitoruj`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await res.json()).umowa;
}

test('POST /wniosek — bez tokenu => 401', async () => {
  const { status } = await wniosek(null, { wartosc_kontraktu: 1000000, wskaznik_bazowy: 100, wskaznik_aktualny: 112 });
  assert.equal(status, 401);
});

test('POST /wniosek — pełne dane => 200 z kwotą, podstawą i treścią (JSON)', async () => {
  const token = await zaloz(`wniosek-${process.pid}@t.pl`);
  const { status, text } = await wniosek(token, {
    wartosc_kontraktu: 1_000_000, wskaznik_bazowy: 100, wskaznik_aktualny: 112, prog: 5,
    branza: 'budownictwo', numer_umowy: 'ZP/12/2026',
  });
  assert.equal(status, 200, text);
  const json = JSON.parse(text);
  assert.equal(json.wniosek.mozliwy, true);
  assert.equal(json.wniosek.wzrost, 12);
  assert.equal(json.wniosek.kwota, 120000);
  assert.equal(json.wniosek.podstawa.rodzaj, 'klauzula_umowna');
  assert.match(json.wniosek.nazwa_pliku, /\.txt$/);
  assert.match(json.wniosek.tresc, /art\.?\s*439/);
});

test('POST /wniosek?pobierz=1 — eksport do pliku jako załącznik', async () => {
  const token = await zaloz(`pobierz-${process.pid}@t.pl`);
  const { status, headers, text } = await wniosek(token, {
    wartosc_kontraktu: 1_000_000, wskaznik_bazowy: 100, wskaznik_aktualny: 112, prog: 5, branza: 'budownictwo',
  }, '?pobierz=1');
  assert.equal(status, 200, text);
  assert.match(headers.get('content-type'), /text\/plain/);
  const cd = headers.get('content-disposition');
  assert.match(cd, /attachment/);
  assert.match(cd, /filename=.*\.txt/);
  assert.match(text, /WNIOSEK O WALORYZACJ/i);
  assert.match(text, /120\D?000/); // kwota w treści pliku
});

test('POST /wniosek — brak wartości kontraktu => 400', async () => {
  const token = await zaloz(`bezwartosci-${process.pid}@t.pl`);
  const { status } = await wniosek(token, { wskaznik_bazowy: 100, wskaznik_aktualny: 112, prog: 5 });
  assert.equal(status, 400);
});

test('POST /wniosek — spadek cen (brak podstawy) => 422', async () => {
  const token = await zaloz(`spadek-${process.pid}@t.pl`);
  const { status, text } = await wniosek(token, {
    wartosc_kontraktu: 1_000_000, wskaznik_bazowy: 120, wskaznik_aktualny: 110, prog: 5,
  });
  assert.equal(status, 422, text);
});

test('POST /wniosek — z umowa_id zaciąga wskaźnik bazowy i próg z monitorowanej umowy', async () => {
  const token = await zaloz(`zumowa-${process.pid}@t.pl`);
  const umowa = await monitoruj(token, { branza: 'budownictwo', wskaznik_bazowy: 100, prog: 10 });
  const { status, text } = await wniosek(token, {
    umowa_id: umowa.id, wskaznik_aktualny: 130, wartosc_kontraktu: 200000,
  });
  assert.equal(status, 200, text);
  const json = JSON.parse(text);
  assert.equal(json.wniosek.wzrost, 30);       // 100 -> 130 (baza z rekordu)
  assert.equal(json.wniosek.kwota, 60000);     // 200 000 × 30%
  assert.equal(json.wniosek.podstawa.rodzaj, 'klauzula_umowna'); // prog 10 z rekordu przekroczony
  assert.match(json.wniosek.nazwa_pliku, /budownictwo/);         // branża z rekordu
});

test('POST /wniosek — umowa_id należąca do innego użytkownika => 404', async () => {
  const owner = await zaloz(`owner-w-${process.pid}@t.pl`);
  const obcy = await zaloz(`obcy-w-${process.pid}@t.pl`);
  const umowa = await monitoruj(owner, { branza: 'transport', wskaznik_bazowy: 100, prog: 5 });
  const { status } = await wniosek(obcy, {
    umowa_id: umowa.id, wskaznik_aktualny: 130, wartosc_kontraktu: 200000,
  });
  assert.equal(status, 404);
});
