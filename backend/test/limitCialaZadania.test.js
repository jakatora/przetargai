import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Limity rozmiaru ciała żądania (P0, 2026-09-25).
 *
 * Globalny `express.json({ limit: '1mb' })` był zamontowany PRZED parserami tras z
 * większym limitem (10 MB dla modułów PrzetargAI, 12 MB dla skanu ISO Fittera).
 * body-parser pomija ciało, które już raz przeczytano, więc realny limit KAŻDEJ
 * trasy wynosił 1 MB: plik 900 KB w Sejfie, umowa 2 MB czy zdjęcie rysunku ISO
 * 3 MB kończyły się 500 „Wewnętrzny błąd serwera". Do tego handler błędów nie znał
 * `entity.too.large`, więc nawet uczciwie za duże żądanie dostawało 500 zamiast 413.
 *
 * Sprawdzamy przez PRAWDZIWĄ aplikację (createApp + fetch), że:
 *  - trasy z własnym limitem przyjmują ciała ponad 1 MB (Sejf 2 MB, umowa 2 MB,
 *    skan ISO 3 MB — ten ostatni dochodzi do walidacji, czyli parser go przepuścił),
 *  - ciało ponad limit trasy daje 413 ZA_DUZY_PLIK z czytelnym komunikatem PL,
 *  - trasy bez własnego parsera dalej mają 1 MB (i też dostają 413, nie 500).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-limit-ciala-${process.pid}.db`);
const STORAGE_DIR = path.join(os.tmpdir(), `przetargai-limit-ciala-store-${process.pid}`);
process.env.DATABASE_PATH = DB_FILE;
process.env.SEJF_STORAGE_DIR = STORAGE_DIR;
// Fałszywy klucz: skan ISO sprawdza `features.ai` PRZED walidacją ciała — bez klucza
// odpowiedziałby 503 i nie dowiedzielibyśmy się, czy parser przepuścił 3 MB. Żadne
// żądanie w tym pliku nie dochodzi do wywołania Anthropic (walidacja odrzuca wcześniej).
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-nieprawdziwy';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');

const MB = 1024 * 1024;

let server;
let base;
let token;

before(() => {
  migrate();
  const u = users.create({ companyNip: null, companyName: null, email: `limit-ciala-${process.pid}@t.pl`, passwordHash: 'h' });
  token = signToken(u.id);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
});

async function wyslij(sciezka, cialo, { zTokenem = true } = {}) {
  const res = await fetch(`${base}${sciezka}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(zTokenem ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof cialo === 'string' ? cialo : JSON.stringify(cialo),
  });
  let json = null;
  try { json = await res.json(); } catch { /* bez treści */ }
  return { status: res.status, json };
}

/** Podpisany PDF-owy „skan" dopchany do zadanej liczby bajtów (base64 w JSON). */
function pdfBase64(bajty) {
  const naglowek = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n', 'latin1');
  const stopka = Buffer.from('\n%%EOF', 'latin1');
  const wypelnienie = Buffer.alloc(Math.max(0, bajty - naglowek.length - stopka.length), 0x41);
  return Buffer.concat([naglowek, wypelnienie, stopka]).toString('base64');
}

async function dodajDokument() {
  const { status, json } = await wyslij('/api/przetarg/sejf/dokumenty', { typ: 'krk' });
  assert.equal(status, 201, JSON.stringify(json));
  return json.dokument.id;
}

test('Sejf: plik ~2 MB (base64) przechodzi przez parser trasy (10 MB), a nie 500/413', async () => {
  const id = await dodajDokument();
  const cialo = { nazwa_pliku: 'krk.pdf', plik_base64: pdfBase64(1.5 * MB) };
  assert.ok(JSON.stringify(cialo).length > 1.9 * MB, 'ciało musi przekraczać stary globalny limit 1 MB');

  const { status, json } = await wyslij(`/api/przetarg/sejf/dokumenty/${id}/plik`, cialo);
  assert.notEqual(status, 500, JSON.stringify(json));
  assert.notEqual(status, 413, JSON.stringify(json));
  assert.equal(status, 200, JSON.stringify(json));
});

test('Sejf: ciało 11 MB => 413 ZA_DUZY_PLIK z komunikatem PL (nie 500)', async () => {
  const id = await dodajDokument();
  const cialo = { nazwa_pliku: 'duzy.pdf', plik_base64: 'A'.repeat(11 * MB) };

  const { status, json } = await wyslij(`/api/przetarg/sejf/dokumenty/${id}/plik`, cialo);
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json?.error?.code, 'ZA_DUZY_PLIK');
  assert.match(json.error.message, /za du[żz]/i, 'komunikat po polsku mówi, że plik jest za duży');
  assert.match(json.error.message, /10 MB/, 'komunikat podaje limit trasy');
});

test('Umowa: analiza tekstu ~2 MB przechodzi przez parser trasy (nie 500/413)', async () => {
  const akapit = 'Wykonawca zapłaci karę umowną w wysokości 0,5% wynagrodzenia za każdy dzień zwłoki. ';
  const tekst = akapit.repeat(Math.ceil((2 * MB) / akapit.length));

  const { status, json } = await wyslij('/api/przetarg/umowa/analiza', { tekst });
  assert.notEqual(status, 500, JSON.stringify(json)?.slice(0, 300));
  assert.notEqual(status, 413, JSON.stringify(json)?.slice(0, 300));
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.flagi), 'kontrakt odpowiedzi bez zmian');
});

test('Fitter scan-iso: zdjęcie 3 MB dochodzi do walidacji (parser 12 MB), nie 413/500', async () => {
  // Brak `device_id` => walidacja trasy odrzuca 400 ZANIM powstanie jakiekolwiek
  // wywołanie AI. Sam fakt 400 dowodzi, że 3 MB przeszły przez parser.
  const cialo = { image_base64: 'A'.repeat(3 * MB), media_type: 'image/jpeg' };

  const { status, json } = await wyslij('/api/fitter/scan-iso', cialo, { zTokenem: false });
  assert.notEqual(status, 500, JSON.stringify(json));
  assert.notEqual(status, 413, JSON.stringify(json));
  assert.equal(status, 400, JSON.stringify(json));
});

test('Fitter scan-iso: 13 MB => 413 ZA_DUZY_PLIK (limit 12 MB bez zmian)', async () => {
  const cialo = { image_base64: 'A'.repeat(13 * MB), device_id: 'urzadzenie-testowe' };
  const { status, json } = await wyslij('/api/fitter/scan-iso', cialo, { zTokenem: false });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json?.error?.code, 'ZA_DUZY_PLIK');
});

test('Trasa bez własnego parsera zostaje przy 1 MB — i też dostaje 413, nie 500', async () => {
  const cialo = { dane: 'A'.repeat(2 * MB) };
  const { status, json } = await wyslij('/api/przetarg/zobowiazanie', cialo);
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json?.error?.code, 'ZA_DUZY_PLIK');
  assert.match(json.error.message, /1 MB/);
});
