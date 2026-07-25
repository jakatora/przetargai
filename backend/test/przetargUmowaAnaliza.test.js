import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { budujPdf } from './helpers/buildPdf.js';

/*
 * Szkielet endpointu analizy projektu umowy (POST /api/przetarg/umowa/analiza).
 * Ulepszenie „pilnowanie waloryzacji i pułapek w umowie" (podzadanie 1/12).
 *
 * Na tym etapie sprawdzamy WYŁĄCZNIE routing i walidację wejścia:
 *  - przyjmuje surowy `tekst` umowy LUB `pdf_base64` (plik PDF w base64),
 *  - brak treści => 400,
 *  - handler zwraca pustą kopertę wyniku { tekst, flagi: [] }.
 * Silnik reguł (flagi waloryzacji, kar umownych, odbiorów, podwykonawców)
 * oraz ekstrakcja tekstu z PDF-a dochodzą w kolejnych podzadaniach.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-umowa-test-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = ''; // bez wysyłki maili w testach

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

async function analiza(body) {
  const res = await fetch(`${base}/api/przetarg/umowa/analiza`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('POST /api/przetarg/umowa/analiza — tekst umowy zwraca pustą kopertę { tekst, flagi: [] }', async () => {
  const tresc = 'Umowa na roboty budowlane, termin realizacji 12 miesięcy.';
  const { status, json } = await analiza({ tekst: tresc });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.tekst, tresc, 'handler oddaje z powrotem analizowany tekst');
  assert.deepEqual(json.flagi, [], 'szkielet zwraca pustą listę flag');
});

test('POST /api/przetarg/umowa/analiza — plik PDF (base64) jest przyjmowany', async () => {
  const { status, json } = await analiza({ pdf_base64: 'JVBERi0xLjQKJXVkbXktcGRmLWJ5dGVz' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(typeof json.tekst, 'string', 'tekst zawsze jest łańcuchem');
  assert.deepEqual(json.flagi, []);
});

test('POST /api/przetarg/umowa/analiza — z prawdziwego PDF-a wyciąga i normalizuje tekst', async () => {
  // Dowód podpięcia util `ekstrahuj_i_normalizuj` do endpointu: szkielet 1/12
  // dla samego PDF-a zwracał pusty `tekst` — teraz musi zawierać treść pliku.
  const { status, json } = await analiza({
    pdf_base64: budujPdf('Klauzula waloryzacyjna art. 439 ustawy Pzp'),
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.match(json.tekst, /waloryzacyjna/, 'endpoint zwraca tekst wyekstrahowany z PDF-a');
  assert.match(json.tekst, /439/);
  assert.deepEqual(json.flagi, []);
});

test('POST /api/przetarg/umowa/analiza — brak treści (puste body) => 400', async () => {
  const { status, json } = await analiza({});
  assert.equal(status, 400, JSON.stringify(json));
  assert.equal(json.error.code, 'BAD_REQUEST');
});

test('POST /api/przetarg/umowa/analiza — sam biały znak (bez PDF) => 400', async () => {
  const { status, json } = await analiza({ tekst: '   \n\t  ' });
  assert.equal(status, 400, JSON.stringify(json));
  assert.equal(json.error.code, 'BAD_REQUEST');
});
