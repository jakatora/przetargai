import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * MOST ATLAS-a — przekaźnik telefon ↔ komputer właściciela (`routes/atlasMost.js`).
 *
 * Router powstał 2026-08-13, ale commit nigdy nie trafił na produkcję: ATLAS przez 15 dni
 * dostawał z Railway 404 i telefon nie miał jak dojść do domu. Test istnieje po to, żeby
 * następnym razem awaria była widoczna TUTAJ, a nie dopiero w polu.
 *
 * Testujemy PEŁNY OBIEG przez prawdziwą aplikację Express, w obu kolejnościach zdarzeń:
 *   (a) ATLAS wisi na long pollu → żądanie telefonu ma trafić do niego NATYCHMIAST,
 *   (b) telefon pierwszy → żądanie czeka w kolejce, aż ATLAS się zgłosi.
 * Do tego twarde niezmienniki rury: sekret domu chroni oba wejścia ATLAS-a (401), nagłówek
 * `Authorization` telefonu przechodzi NIETKNIĘTY (autoryzuje bramka pilota w ATLAS-ie, nie tu),
 * a status i body ATLAS-a wracają do telefonu bez zmian.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-atlas-most-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.ATLAS_MOST_SEKRET = 'sekret-domu-testowy'; // router czyta env przy imporcie

const SEKRET = process.env.ATLAS_MOST_SEKRET;

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

const jakoAtlas = (sciezka, opcje = {}) =>
  fetch(`${base}/api/atlas${sciezka}`, {
    ...opcje,
    headers: { Authorization: `Bearer ${SEKRET}`, ...(opcje.headers || {}) },
  });

/** Odsyła ATLAS-owi wynik żądania telefonu — dokładnie to robi `most_zdalny.py`. */
const odeslij = (odpowiedz) =>
  jakoAtlas('/odpowiedz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(odpowiedz),
  });

test('sekret domu chroni oba wejścia ATLAS-a', async () => {
  const bezSekretu = await fetch(`${base}/api/atlas/pobierz`);
  assert.equal(bezSekretu.status, 401);

  const zlySekret = await fetch(`${base}/api/atlas/pobierz`, {
    headers: { Authorization: 'Bearer nie-ten-dom' },
  });
  assert.equal(zlySekret.status, 401);

  const odpowiedzBezSekretu = await fetch(`${base}/api/atlas/odpowiedz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'z1', status: 200, body: '{}' }),
  });
  assert.equal(odpowiedzBezSekretu.status, 401);
});

test('ATLAS wisi na long pollu — żądanie telefonu dostaje natychmiast, z nietkniętym tokenem', async () => {
  const atlasCzeka = jakoAtlas('/pobierz');           // long poll — bez await, ma wisieć
  await new Promise((r) => setTimeout(r, 100));       // daj mu się zarejestrować

  const telefon = fetch(`${base}/api/atlas/p/api/pilot/raport?limit=5`, {
    headers: { Authorization: 'Bearer token-telefonu' },
  });

  const zadanie = await (await atlasCzeka).json();
  assert.equal(zadanie.sciezka, '/api/pilot/raport');
  assert.equal(zadanie.metoda, 'GET');
  // Rura jest GŁUPIA: token telefonu przechodzi bez tknięcia, sprawdza go bramka w ATLAS-ie.
  assert.equal(zadanie.autoryzacja, 'Bearer token-telefonu');
  assert.ok(zadanie.id);

  await odeslij({ id: zadanie.id, status: 200, body: JSON.stringify({ raport: 'ok' }) });

  const odp = await telefon;
  assert.equal(odp.status, 200);
  assert.deepEqual(await odp.json(), { raport: 'ok' });
});

test('telefon pierwszy — żądanie czeka w kolejce na ATLAS-a', async () => {
  const telefon = fetch(`${base}/api/atlas/p/api/pilot/komenda`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-telefonu', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tresc: 'zrób raport' }),
  });
  await new Promise((r) => setTimeout(r, 100));

  const zadanie = await (await jakoAtlas('/pobierz')).json();
  assert.equal(zadanie.sciezka, '/api/pilot/komenda');
  assert.equal(zadanie.metoda, 'POST');
  assert.deepEqual(JSON.parse(zadanie.body), { tresc: 'zrób raport' });

  // Status błędu z ATLAS-a też ma wrócić do telefonu bez podmiany — inaczej 401 bramki
  // wyglądałby na telefonie jak sukces.
  await odeslij({ id: zadanie.id, status: 401, body: JSON.stringify({ blad: 'brak parowania' }) });

  const odp = await telefon;
  assert.equal(odp.status, 401);
  assert.deepEqual(await odp.json(), { blad: 'brak parowania' });
});

test('stan mostu mówi, czy dom jest podłączony — bez ujawniania czegokolwiek', async () => {
  const stan = await (await fetch(`${base}/api/atlas/stan`)).json();
  assert.equal(stan.skonfigurowany, true);
  assert.equal(stan.w_kolejce, 0);
  assert.equal(stan.czekajacych, 0);
  assert.equal(typeof stan.dom_podlaczony, 'boolean');
  assert.equal(Object.keys(stan).length, 4); // nic ponad to — żadnych ścieżek ani tokenów
});
