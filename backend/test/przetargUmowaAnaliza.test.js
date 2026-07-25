import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { budujPdf } from './helpers/buildPdf.js';

/*
 * Endpoint analizy projektu umowy (POST /api/przetarg/umowa/analiza).
 * Ulepszenie „pilnowanie waloryzacji i pułapek w umowie".
 *
 * Sprawdzamy:
 *  - routing i walidację wejścia (surowy `tekst` LUB `pdf_base64`; brak treści => 400),
 *  - JEDNOLITY kontrakt wyniku (podzadanie 7/12): { tekst, flagi } gdzie `flagi`
 *    to lista `[{ typ, kolor, tytul, opis }]` — po jednej fladze na obszar umowy
 *    (waloryzacja / kary / odbiory / podwykonawcy), w stałej kolejności,
 *  - że detektory faktycznie działają end-to-end (klauzula waloryzacyjna z PDF-a
 *    => zielona flaga; kary bez limitu => czerwona flaga; `miesiace` przełącza
 *    brak klauzuli na czerwoną flagę art. 439 Pzp).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-umowa-test-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = ''; // bez wysyłki maili w testach

const { migrate } = await import('../src/db/migrate.js');
migrate();

const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

const TYPY = ['waloryzacja', 'kary', 'odbiory', 'podwykonawcy'];
const KOLORY = new Set(['zielony', 'pomarańczowy', 'czerwony']);

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

/** Wspólne asercje kontraktu listy flag (kształt niezależny od treści umowy). */
function asertujKontraktFlag(flagi) {
  assert.ok(Array.isArray(flagi), 'flagi to lista');
  assert.deepEqual(flagi.map((f) => f.typ), TYPY, 'jedna flaga na obszar, stała kolejność');
  for (const f of flagi) {
    assert.ok(KOLORY.has(f.kolor), `kolor z dozwolonej skali: ${f.kolor}`);
    assert.ok(typeof f.tytul === 'string' && f.tytul.length > 0, 'tytul niepusty');
    assert.ok(typeof f.opis === 'string' && f.opis.length > 0, 'opis niepusty');
  }
}

function flagaTypu(flagi, typ) {
  return flagi.find((f) => f.typ === typ);
}

test('POST /analiza — tekst umowy zwraca kontrakt { tekst, flagi[{typ,kolor,tytul,opis}] }', async () => {
  const tresc = 'Umowa na roboty budowlane, termin realizacji 12 miesięcy.';
  const { status, json } = await analiza({ tekst: tresc });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.tekst, tresc, 'handler oddaje z powrotem analizowany tekst');
  asertujKontraktFlag(json.flagi);
});

test('POST /analiza — plik PDF (base64) jest przyjmowany i zwraca komplet flag', async () => {
  const { status, json } = await analiza({ pdf_base64: 'JVBERi0xLjQKJXVkbXktcGRmLWJ5dGVz' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(typeof json.tekst, 'string', 'tekst zawsze jest łańcuchem');
  asertujKontraktFlag(json.flagi);
});

test('POST /analiza — z PDF-a z klauzulą waloryzacyjną wychodzi ZIELONA flaga waloryzacji', async () => {
  const { status, json } = await analiza({
    pdf_base64: budujPdf('Klauzula waloryzacyjna art. 439 ustawy Pzp'),
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.match(json.tekst, /waloryzacyjna/, 'endpoint zwraca tekst wyekstrahowany z PDF-a');
  asertujKontraktFlag(json.flagi);
  assert.equal(flagaTypu(json.flagi, 'waloryzacja').kolor, 'zielony', JSON.stringify(json.flagi));
});

test('POST /analiza — kary umowne bez limitu dają CZERWONĄ flagę kar', async () => {
  const { status, json } = await analiza({
    tekst: 'Wykonawca zapłaci karę umowną 0,5% wynagrodzenia za każdy dzień zwłoki.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  const kary = flagaTypu(json.flagi, 'kary');
  assert.equal(kary.kolor, 'czerwony', JSON.stringify(kary));
});

test('POST /analiza — `miesiace` > 6 bez klauzuli przełącza flagę waloryzacji na CZERWONĄ', async () => {
  const tekst = 'Umowa na dostawę materiałów zgodnie z harmonogramem.';
  const bezCzasu = flagaTypu((await analiza({ tekst })).json.flagi, 'waloryzacja');
  assert.equal(bezCzasu.kolor, 'pomarańczowy', 'nieznany czas => uwaga, nie naruszenie');
  const zCzasem = flagaTypu((await analiza({ tekst, miesiace: 12 })).json.flagi, 'waloryzacja');
  assert.equal(zCzasem.kolor, 'czerwony', 'znany czas > 6 mies. => naruszenie art. 439 Pzp');
});

test('POST /analiza — brak treści (puste body) => 400', async () => {
  const { status, json } = await analiza({});
  assert.equal(status, 400, JSON.stringify(json));
  assert.equal(json.error.code, 'BAD_REQUEST');
});

test('POST /analiza — sam biały znak (bez PDF) => 400', async () => {
  const { status, json } = await analiza({ tekst: '   \n\t  ' });
  assert.equal(status, 400, JSON.stringify(json));
  assert.equal(json.error.code, 'BAD_REQUEST');
});
