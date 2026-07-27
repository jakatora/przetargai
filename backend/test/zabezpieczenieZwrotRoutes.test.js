import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpointy „Odzyskiwacza zabezpieczenia" (ulepszenie „pilnuj zwrotu swoich pieniędzy
 * po kontrakcie"). Router `routes/zabezpieczenieZwrot.js` montowany pod
 * `/api/przetarg/zabezpieczenie` — spójnie ze wzorcem routera Radaru planów /
 * Symulatora płynności: samodzielny, walidacja zod, uwierzytelnienie, ale BEZSTANOWY
 * (spina czyste liby zabezpieczenieZwrot.js + zabezpieczenieWezwanie.js — bez DB,
 * bez płatnego AI).
 *
 * Testujemy PEŁNĄ ŚCIEŻKĘ przez PRAWDZIWĄ aplikację Express:
 *   POST /harmonogram (kwota + daty [+ dzisiaj] → transze z terminami i statusem),
 *   POST /porownaj    (kwota + lata + stawki → koszt gotówka vs gwarancja),
 *   POST /wezwanie     (kwota + termin [+ dzisiaj] → gotowe pismo; ?pobierz=1 → plik),
 * plus 401 bez tokenu i 400 na błędne wejście.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-zz-rt-${process.pid}.db`);
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

const ROOT = `/api/przetarg/zabezpieczenie`;

async function zaloz(email) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'haslo12345', keywords: ['budownictwo'] }),
  });
  return (await res.json()).token;
}

function naglowki(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function post(token, sciezka, body) {
  const res = await fetch(`${base}${ROOT}${sciezka}`, {
    method: 'POST', headers: naglowki(token), body: JSON.stringify(body ?? {}),
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, ct, json: payload };
}

// ══════════════════════════ Auth ══════════════════════════════════════════════

test('POST /harmonogram — bez tokenu => 401', async () => {
  const { status } = await post(null, '/harmonogram', {
    kwota: 50_000, dataNalezytegoWykonania: '2027-05-31', dataUplywuRekojmi: '2032-05-31',
  });
  assert.equal(status, 401);
});

// ══════════════════════════ Harmonogram + status ══════════════════════════════

test('POST /harmonogram — transze z terminami; status i alarm wg wstrzykniętego dzisiaj', async () => {
  const token = await zaloz(`zz-harm-${process.pid}@t.pl`);
  const r = await post(token, '/harmonogram', {
    kwota: 50_000,
    dataNalezytegoWykonania: '2027-05-31',
    dataUplywuRekojmi: '2032-05-31',
    dzisiaj: '2027-06-30', // dzień terminu transzy „po odbiorze" → wymagalne
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const h = r.json.harmonogram;
  assert.equal(h.transze.length, 2);
  assert.equal(h.transze[0].termin, '2027-06-30');
  assert.equal(h.transze[0].status, 'wymagalne', 'w dniu terminu → można żądać');
  assert.equal(h.transze[1].status, 'oczekuje', 'transza po rękojmi jeszcze niewymagalna');
  assert.equal(r.json.alarm, true, 'jest transza, której można dziś żądać');
});

test('POST /harmonogram — przeterminowana transza niesie naliczone odsetki', async () => {
  const token = await zaloz(`zz-harm-ods-${process.pid}@t.pl`);
  const r = await post(token, '/harmonogram', {
    kwota: 50_000,
    dataNalezytegoWykonania: '2027-05-31',
    dataUplywuRekojmi: '2032-05-31',
    dzisiaj: '2027-08-30', // 61 dni po terminie transzy „po odbiorze"
    stopaRoczna: 10,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t1 = r.json.harmonogram.transze[0];
  assert.equal(t1.status, 'przeterminowane');
  assert.ok(t1.odsetki > 0, 'po terminie naliczamy odsetki');
});

// ══════════════════════════ Porównanie kosztu ═════════════════════════════════

test('POST /porownaj — koszt gotówki vs gwarancji + tańsza opcja', async () => {
  const token = await zaloz(`zz-por-${process.pid}@t.pl`);
  const r = await post(token, '/porownaj', {
    kwota: 100_000, lata: 5, prowizjaGwarancjiRocznaProc: 1.5, kosztKapitaluRocznyProc: 8,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.porownanie.gotowka.koszt, 40_000);
  assert.equal(r.json.porownanie.gwarancja.koszt, 7_500);
  assert.equal(r.json.porownanie.tanszaOpcja, 'gwarancja');
});

// ══════════════════════════ Wezwanie do zwrotu ════════════════════════════════

test('POST /wezwanie — przeterminowane pismo z art. 405 KC i odsetkami', async () => {
  const token = await zaloz(`zz-wez-${process.pid}@t.pl`);
  const r = await post(token, '/wezwanie', {
    kwota: 35_000, termin: '2027-06-30', dzisiaj: '2028-06-30', stopaRoczna: 10,
    numerUmowy: 'ZP/12/2026', zamawiajacy: 'Gmina Przykładowa',
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.wezwanie.wariant, 'przeterminowane');
  assert.match(r.json.wezwanie.tresc, /art\. ?405/);
  assert.ok(r.json.wezwanie.kwotaZadania > 35_000, 'żądanie = kwota + odsetki');
});

test('POST /wezwanie?pobierz=1 — eksport treści jako załącznik .txt', async () => {
  const token = await zaloz(`zz-wez-plik-${process.pid}@t.pl`);
  const res = await fetch(`${base}${ROOT}/wezwanie?pobierz=1`, {
    method: 'POST',
    headers: naglowki(token),
    body: JSON.stringify({ kwota: 35_000, termin: '2027-06-30', dzisiaj: '2027-06-30', numerUmowy: 'ZP/12/2026' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename=/);
  const tekst = await res.text();
  assert.match(tekst, /WEZWANIE DO ZWROTU ZABEZPIECZENIA/);
});

// ══════════════════════════ Walidacja wejścia ═════════════════════════════════

test('POST /harmonogram — brak kwoty/dat => 400', async () => {
  const token = await zaloz(`zz-harm-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/harmonogram', { dataNalezytegoWykonania: '2027-05-31', dataUplywuRekojmi: '2032-05-31' })).status, 400);
  assert.equal((await post(token, '/harmonogram', { kwota: -5, dataNalezytegoWykonania: '2027-05-31', dataUplywuRekojmi: '2032-05-31' })).status, 400);
  assert.equal((await post(token, '/harmonogram', { kwota: 50_000, dataNalezytegoWykonania: 'zła-data', dataUplywuRekojmi: '2032-05-31' })).status, 400);
});

test('POST /porownaj — brak kwoty lub lat => 400', async () => {
  const token = await zaloz(`zz-por-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/porownaj', { lata: 5 })).status, 400);
  assert.equal((await post(token, '/porownaj', { kwota: 100_000 })).status, 400);
});

test('POST /wezwanie — brak kwoty lub terminu => 400', async () => {
  const token = await zaloz(`zz-wez-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/wezwanie', { termin: '2027-06-30' })).status, 400);
  assert.equal((await post(token, '/wezwanie', { kwota: 35_000 })).status, 400);
});
