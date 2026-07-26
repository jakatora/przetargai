import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpoint EKSPORTU dokumentu „zobowiązanie podmiotu udostępniającego zasoby"
 * (art. 118 Pzp) — podzadanie 8/12 ulepszenia „Pożycz doświadczenie". Trasa spina
 * generator (7/12) z eksportem do pliku i wystawia je tym samym wzorcem, co eksport
 * wniosku o waloryzację (?pobierz=1 => załącznik .txt). Test jedzie na żywej
 * aplikacji przez HTTP — dowód „o rzeczywistość" dla wpięcia generatora w eksport.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-zobowiazanie-eksport-${process.pid}.db`);
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

// Kompletny model (wszystkie pola wymagane wypełnione) + meta postępowania.
const KOMPLETNY = {
  dane_podmiotu: {
    nazwa: 'Budrem Sp. z o.o.',
    identyfikator: 'NIP 5252525252',
    adres: 'ul. Budowlana 1, 00-001 Warszawa',
    reprezentant: 'Jan Kowalski, prezes zarządu',
  },
  zakres_doswiadczenia: 'Budowa oczyszczalni ścieków min. 5000 m³/d (jedna realizacja, 6,2 mln zł).',
  sposob_udostepnienia: 'Udział jako podwykonawca robót technologicznych oraz nadzór własnej kadry.',
  okres_udostepnienia: 'Przez cały okres realizacji zamówienia (18 miesięcy).',
  zakres_podwykonawstwa: 'Wykonanie części technologicznej oczyszczalni (montaż i rozruch).',
};
const META = {
  wykonawca: 'Instal-Bud Nowak Sp.k.',
  zamawiajacy: 'Gmina Przykładowa',
  przedmiot_zamowienia: 'Budowa oczyszczalni ścieków',
  numer_postepowania: 'ZP/12/2026',
  miejscowosc: 'Warszawa',
  data_pisma: '2026-07-26',
};

async function eksport(body, query = '') {
  const res = await fetch(`${base}/api/przetarg/zobowiazanie${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

test('POST /zobowiazanie — kompletny model => 200 JSON z podglądem, nazwą pliku i treścią', async () => {
  const { status, text } = await eksport({ zobowiazanie: KOMPLETNY, meta: META });
  assert.equal(status, 200, text);
  const json = JSON.parse(text);
  assert.equal(json.zobowiazanie.kompletne, true);
  assert.deepEqual(json.zobowiazanie.braki, []);
  assert.match(json.zobowiazanie.nazwa_pliku, /^zobowiazanie-podmiotu-.*\.txt$/);
  assert.match(json.zobowiazanie.tresc, /ZOBOWIĄZANIE PODMIOTU UDOSTĘPNIAJĄCEGO ZASOBY/);
  assert.match(json.zobowiazanie.tresc, /art\.?\s*118/);
});

test('POST /zobowiazanie?pobierz=1 — kompletny => eksport treści jako załącznik .txt', async () => {
  const { status, headers, text } = await eksport({ zobowiazanie: KOMPLETNY, meta: META }, '?pobierz=1');
  assert.equal(status, 200, text);
  assert.match(headers.get('content-type'), /text\/plain/);
  const cd = headers.get('content-disposition');
  assert.match(cd, /attachment/);
  assert.match(cd, /filename=.*\.txt/);
  assert.match(text, /ZOBOWIĄZANIE PODMIOTU UDOSTĘPNIAJĄCEGO ZASOBY/);
  assert.match(text, /Budrem/); // nazwa podmiotu trafia do treści pisma
});

test('POST /zobowiazanie — niekompletny model => 200 JSON z kompletne:false i listą braków (podgląd)', async () => {
  const { zakres_podwykonawstwa, ...bezPodwykonawstwa } = KOMPLETNY; // brak pola-pułapki
  const { status, text } = await eksport({ zobowiazanie: bezPodwykonawstwa, meta: META });
  assert.equal(status, 200, text);
  const json = JSON.parse(text);
  assert.equal(json.zobowiazanie.kompletne, false);
  assert.ok(json.zobowiazanie.braki.some((b) => b.id === 'zakres-podwykonawstwa'));
  // Podgląd treści nadal jest (z widocznym markerem uzupełnienia), nie znika po cichu.
  assert.match(json.zobowiazanie.tresc, /UZUPEŁNIJ/);
});

test('POST /zobowiazanie?pobierz=1 — niekompletny => 422 (odmowa eksportu niegotowego pisma) z brakami', async () => {
  const { zakres_podwykonawstwa, ...bezPodwykonawstwa } = KOMPLETNY;
  const { status, text } = await eksport({ zobowiazanie: bezPodwykonawstwa, meta: META }, '?pobierz=1');
  assert.equal(status, 422, text);
  const json = JSON.parse(text);
  assert.equal(json.error.code, 'ZOBOWIAZANIE_NIEKOMPLETNE');
  assert.ok(json.error.details.braki.some((b) => b.id === 'zakres-podwykonawstwa'));
});

test('POST /zobowiazanie — brak pola "zobowiazanie" w body => 400', async () => {
  const { status } = await eksport({ meta: META });
  assert.equal(status, 400);
});
