import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createCzarnaSkrzynka } from '../src/services/czarnaSkrzynka.js';
import { runDostepnoscMonitor, pingPlatformy } from '../src/jobs/dostepnosc-platformy.js';

/*
 * Monitor dostępności platformy składania ofert (ulepszenie „Czarna skrzynka składania
 * oferty — dowody na awarię platformy", podzadanie 2/7). Rejestrator lotu ma DOWIEŚĆ
 * przed KIO, że platforma była (nie)dostępna w godzinach przed terminem — ciężar dowodu
 * awarii spoczywa na wykonawcy. Testujemy dwie rzeczy:
 *  1. ZAPIS WYNIKU — cykliczny ping (kod HTTP, czas odpowiedzi, znacznik czasu serwera)
 *     trafia do append-only logu KAŻDEJ otwartej sesji (oferta jeszcze niezłożona).
 *  2. GRANICE — pingujemy raz na cykl (fakt globalny), pomijamy sesje z już złożoną
 *     ofertą, a bez otwartych sesji nie ruszamy sieci (no-op, zero kosztu).
 * Wpięcie w scheduler sprawdza test/scheduler.test.js (spójnie z podprogowy-monitor).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
// Tabele czarnej skrzynki bierzemy wprost z migracji 011 (jak czarnaSkrzynka.test.js),
// żeby test był samowystarczalny niezależnie od WIP schema.sql.
const migracjaSql = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/011_czarna_skrzynka.sql'),
  'utf8',
);

function freshDb() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(schemaSql);
  d.exec(migracjaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  return d;
}

/** Magazyn plików w pamięci — potrzebny tylko do „złożenia oferty" (sesja zamknięta). */
function magazynPamiec() {
  const store = new Map();
  return {
    async zapisz(id, format, bajty) { store.set(id, Buffer.from(bajty)); return `mem://${id}.${format}`; },
    async czytaj(id) { return store.get(id); },
  };
}

const ZEGAR = { teraz: () => '2026-07-27T11:45:00.000Z', strefa: () => 'Europe/Warsaw' };

function fabryka(d) {
  return createCzarnaSkrzynka(d, { magazynPlikow: magazynPamiec(), zegar: ZEGAR });
}

// ══════════════════════════ 1. ZAPIS WYNIKU PINGU ════════════════════════════

test('runDostepnoscMonitor — zapisuje wynik pingu (kod HTTP, czas odpowiedzi, znacznik czasu) do logu sesji', async () => {
  const d = freshDb();
  const cs = fabryka(d);
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });

  let pingCalls = 0;
  const wynik = await runDostepnoscMonitor({
    skrzynka: cs,
    ping: async (url) => { pingCalls++; return { url, kodHttp: 200, czasMs: 342, dostepna: true }; },
    url: 'https://ezamowienia.gov.pl',
  });

  assert.equal(wynik.ok, true);
  assert.equal(wynik.sesje, 1);
  assert.equal(wynik.zapisane, 1);
  assert.equal(pingCalls, 1);

  const ping = cs.zdarzenia('u1', s.id).find((z) => z.typ === 'ping');
  assert.ok(ping, 'wpis „ping" w append-only logu sesji');
  assert.match(ping.opis, /200/, 'kod HTTP w opisie');
  assert.match(ping.opis, /342/, 'czas odpowiedzi (ms) w opisie');
  assert.equal(ping.czas_serwera, '2026-07-27T11:45:00.000Z', 'znacznik czasu z zegara serwera');
  assert.equal(ping.strefa_czasowa, 'Europe/Warsaw', 'strefa z zegara serwera');
  d.close();
});

test('runDostepnoscMonitor — pinguje RAZ na cykl, a wynik trafia do wszystkich otwartych sesji', async () => {
  const d = freshDb();
  const cs = fabryka(d);
  const s1 = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  const s2 = cs.rozpocznijSesje('u1', { postepowanieId: 'p2' });

  let pingCalls = 0;
  const wynik = await runDostepnoscMonitor({
    skrzynka: cs,
    ping: async (url) => { pingCalls++; return { url, kodHttp: 503, czasMs: 12000, dostepna: false }; },
    url: 'https://ezamowienia.gov.pl',
  });

  assert.equal(pingCalls, 1, 'dostępność to fakt globalny — jeden ping na cykl');
  assert.equal(wynik.sesje, 2);
  assert.equal(wynik.zapisane, 2);
  assert.ok(cs.zdarzenia('u1', s1.id).some((z) => z.typ === 'ping'));
  const ping2 = cs.zdarzenia('u1', s2.id).find((z) => z.typ === 'ping');
  assert.ok(ping2 && /NIEDOST/i.test(ping2.opis), 'niedostępność (5xx) odnotowana w logu drugiej sesji');
  d.close();
});

test('runDostepnoscMonitor — pomija sesje z już złożoną ofertą (hash_oferty ustawiony)', async () => {
  const d = freshDb();
  const cs = fabryka(d);
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  await cs.zapiszOferte('u1', s.id, Buffer.from('<Oferta/>').toString('base64'), { nazwaPliku: 'oferta.xml' });

  let pingCalls = 0;
  const wynik = await runDostepnoscMonitor({
    skrzynka: cs,
    ping: async () => { pingCalls++; return { url: 'x', kodHttp: 200, czasMs: 5, dostepna: true }; },
  });

  assert.equal(wynik.sesje, 0, 'sesja po złożeniu oferty nie jest już monitorowana');
  assert.equal(pingCalls, 0, 'brak otwartych sesji => sieć nietknięta');
  assert.ok(!cs.zdarzenia('u1', s.id).some((z) => z.typ === 'ping'), 'brak wpisu ping w zamkniętej sesji');
  d.close();
});

test('runDostepnoscMonitor — brak otwartych sesji => no-op (nie rusza sieci)', async () => {
  const d = freshDb();
  const cs = fabryka(d);

  let pingCalls = 0;
  const wynik = await runDostepnoscMonitor({ skrzynka: cs, ping: async () => { pingCalls++; return {}; } });

  assert.equal(wynik.ok, true);
  assert.equal(wynik.sesje, 0);
  assert.equal(wynik.zapisane, 0);
  assert.equal(wynik.wynik, null);
  assert.equal(pingCalls, 0);
  d.close();
});

// ══════════════════════════ 2. PING (transport HTTP) ═════════════════════════

test('pingPlatformy — mierzy kod HTTP i czas odpowiedzi (fetch wstrzykiwany)', async () => {
  let widzianyUrl = null;
  const wynik = await pingPlatformy('https://ezamowienia.gov.pl', {
    fetchImpl: async (u) => { widzianyUrl = u; return { status: 200 }; },
    teraz: (() => { let t = 1000; return () => (t += 342); })(), // 1342 - 1000 = 342 ms
  });
  assert.equal(widzianyUrl, 'https://ezamowienia.gov.pl');
  assert.equal(wynik.kodHttp, 200);
  assert.equal(wynik.dostepna, true);
  assert.equal(wynik.czasMs, 342);
});

test('pingPlatformy — HTTP 5xx => platforma NIEDOSTĘPNA', async () => {
  const wynik = await pingPlatformy('x', { fetchImpl: async () => ({ status: 503 }) });
  assert.equal(wynik.kodHttp, 503);
  assert.equal(wynik.dostepna, false);
});

test('pingPlatformy — błąd sieci => niedostępna, kodHttp=null, komunikat zapisany', async () => {
  const wynik = await pingPlatformy('x', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(wynik.kodHttp, null);
  assert.equal(wynik.dostepna, false);
  assert.match(wynik.blad, /ECONNREFUSED/);
});
