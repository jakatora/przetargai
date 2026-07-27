import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Endpointy Radaru zamówień podprogowych (ulepszenie „Radar zamówień podprogowych —
 * poniżej 170 tys. zł", podzadanie 6/7). End-to-end przez HTTP:
 *   • preferencje: zapis (upsert), lista, skopowanie do właściciela, usunięcie,
 *   • scalony strumień z filtrami (branża/region/próg/tylko latwiejszy_start),
 *   • szczegóły znaleziska wraz z regulaminem,
 *   • ręczne odświeżenie (/odswiez) z ATRAPAMI adapterów i usługi regulaminu
 *     (bez sieci i bez płatnego AI).
 *
 * Bazę stawiamy przez migrate() + jawne wykonanie migracji 009 (odporność na
 * niezacommitowany WIP z schema.sql). Auth jak w radarBramka.test.js (signToken).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-radar-podprog-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_009 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/009_radar_podprogowy.sql'), 'utf8');

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { createPodprogoweRepo } = await import('../src/db/podprogoweRepo.js');
const { createApp } = await import('../src/app.js');
const { ustawZrodlaOdswiezania } = await import('../src/routes/radarPodprogowy.js');

let userId;
let token;
let repo;
let server;
let base;

before(() => {
  migrate();
  db.exec(MIG_009); // idempotentne (CREATE IF NOT EXISTS) — gwarantuje tabele niezależnie od schema.sql
  repo = createPodprogoweRepo(db);
  userId = users.create({ companyNip: null, companyName: null, email: `podprog-${process.pid}@t.pl`, passwordHash: 'h' }).id;
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
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Seeduje ogłoszenie w scalonym strumieniu (bez adaptera — bezpośrednio przez repo). */
function seed({ hash, tytul, branza, region, wartosc, latwiejszy = true, flagi = {} }) {
  return repo.upsert({
    zrodlo: 'bip', id_zewnetrzny: hash, tytul, zamawiajacy: 'Gmina X',
    branza, region, wartosc_netto: wartosc, link: `https://bip.pl/${hash}`,
    latwiejszy_start: latwiejszy, flagi, hash_dedup: hash,
  }).rekord;
}

const P = '/api/przetarg/podprogowe';

// ── Auth ─────────────────────────────────────────────────────────────────────

test('bez tokenu => 401 na trasach radaru', async () => {
  assert.equal((await req('GET', `${P}/preferencje`)).status, 401);
  assert.equal((await req('GET', `${P}/ogloszenia`)).status, 401);
  assert.equal((await req('POST', `${P}/odswiez`, { body: {} })).status, 401);
});

// ── Preferencje ──────────────────────────────────────────────────────────────

test('POST /preferencje — zapis, lista, upsert po parze branża/region', async () => {
  const r1 = await req('POST', `${P}/preferencje`, { tok: token, body: { branza: 'roboty budowlane', region: 'mazowieckie' } });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  assert.equal(r1.json.preferencja.branza, 'roboty budowlane');
  assert.equal(r1.json.preferencja.prog_netto, 170000, 'domyślny próg 170 tys.');

  // Upsert tej samej pary => aktualizacja progu, nie druga preferencja.
  const r2 = await req('POST', `${P}/preferencje`, { tok: token, body: { branza: 'roboty budowlane', region: 'mazowieckie', prog_netto: 120000 } });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.preferencja.prog_netto, 120000);
  assert.equal(r2.json.preferencja.id, r1.json.preferencja.id, 'ta sama preferencja zaktualizowana');

  const lista = await req('GET', `${P}/preferencje`, { tok: token });
  assert.equal(lista.status, 200);
  assert.equal(lista.json.preferencje.length, 1, 'wciąż jedna preferencja dla tej pary');
});

test('POST /preferencje — bez branży i regionu => 400', async () => {
  const r = await req('POST', `${P}/preferencje`, { tok: token, body: { prog_netto: 90000 } });
  assert.equal(r.status, 400);
});

test('DELETE /preferencje/:id — skopowane do właściciela (cudze => 404)', async () => {
  const obcy = users.create({ companyNip: null, companyName: null, email: `podprog-obcy-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  const tokObcy = signToken(obcy);
  const zapis = await req('POST', `${P}/preferencje`, { tok: tokObcy, body: { branza: 'sprzątanie', region: 'śląskie' } });
  const id = zapis.json.preferencja.id;

  // Właściciel z innego konta nie może usunąć cudzej preferencji.
  assert.equal((await req('DELETE', `${P}/preferencje/${id}`, { tok: token })).status, 404);
  // Właściciel usuwa swoją.
  assert.equal((await req('DELETE', `${P}/preferencje/${id}`, { tok: tokObcy })).status, 200);
  assert.equal((await req('DELETE', `${P}/preferencje/${id}`, { tok: tokObcy })).status, 404, 'drugie usunięcie => 404');
});

// ── Scalony strumień + filtry ────────────────────────────────────────────────

test('GET /ogloszenia — filtry branża/region/próg/latwiejszy_start', async () => {
  seed({ hash: 'og-a', tytul: 'Dostawa tonerów', branza: 'dostawy', region: 'mazowieckie', wartosc: 60000, latwiejszy: true });
  seed({ hash: 'og-b', tytul: 'Budowa chodnika', branza: 'roboty budowlane', region: 'śląskie', wartosc: 160000, latwiejszy: false });
  seed({ hash: 'og-c', tytul: 'Sprzątanie biur', branza: 'usługi', region: 'mazowieckie', wartosc: 40000, latwiejszy: true });

  const wszystkie = await req('GET', `${P}/ogloszenia`, { tok: token });
  assert.equal(wszystkie.status, 200);
  assert.ok(wszystkie.json.ogloszenia.length >= 3);

  const branza = await req('GET', `${P}/ogloszenia?branza=dostawy`, { tok: token });
  assert.ok(branza.json.ogloszenia.every((o) => /dostawy/i.test(o.branza)), 'filtr branży zawęża');
  assert.ok(branza.json.ogloszenia.some((o) => o.hash_dedup === 'og-a'));

  const region = await req('GET', `${P}/ogloszenia?region=mazowieckie`, { tok: token });
  const hashe = region.json.ogloszenia.map((o) => o.hash_dedup);
  assert.ok(hashe.includes('og-a') && hashe.includes('og-c') && !hashe.includes('og-b'), 'filtr regionu zawęża');

  const prog = await req('GET', `${P}/ogloszenia?prog=50000`, { tok: token });
  assert.ok(prog.json.ogloszenia.every((o) => o.wartosc_netto < 50000), 'filtr progu odcina drozsze');

  const latwe = await req('GET', `${P}/ogloszenia?latwiejszy_start=1`, { tok: token });
  assert.ok(latwe.json.ogloszenia.every((o) => o.latwiejszy_start === true), 'tylko łatwiejszy start');
  assert.ok(!latwe.json.ogloszenia.some((o) => o.hash_dedup === 'og-b'), 'trudniejsze odfiltrowane');

  const zlyProg = await req('GET', `${P}/ogloszenia?prog=abc`, { tok: token });
  assert.equal(zlyProg.status, 400, 'nieliczbowy prog => 400');
});

test('GET /ogloszenia/:id — szczegóły z polami regulaminu; nieistniejące => 404', async () => {
  const rec = seed({ hash: 'og-detail', tytul: 'Naprawa dachu', branza: 'roboty', region: 'lubelskie', wartosc: 70000 });
  repo.ustawRegulamin(rec.id, { regulamin_url: 'https://bip.pl/regulamin.pdf', regulamin_streszczenie: 'Oferta pisemna w 7 dni, bez wadium.' });

  const r = await req('GET', `${P}/ogloszenia/${rec.id}`, { tok: token });
  assert.equal(r.status, 200);
  assert.equal(r.json.ogloszenie.tytul, 'Naprawa dachu');
  assert.equal(r.json.ogloszenie.regulamin_url, 'https://bip.pl/regulamin.pdf');
  assert.equal(r.json.ogloszenie.regulamin_streszczenie, 'Oferta pisemna w 7 dni, bez wadium.');
  assert.equal(typeof r.json.ogloszenie.latwiejszy_start, 'boolean', 'bool zmapowany z INTEGER');
  assert.equal(typeof r.json.ogloszenie.flagi, 'object', 'flagi zmapowane z JSON');

  assert.equal((await req('GET', `${P}/ogloszenia/widmo`, { tok: token })).status, 404);
});

// ── Ręczne odświeżenie (z atrapami) ──────────────────────────────────────────

test('POST /odswiez — uruchamia adaptery dla preferencji usera, upsertuje i domawia regulamin', async () => {
  // Atrapa adaptera: zwraca ogłoszenie pasujące do preferencji „dostawy/mazowieckie".
  const fakeAdapter = {
    zrodlo: 'bip',
    pobierz: async () => [{
      zrodlo: 'bip', id_zewnetrzny: 'odswiez-1', tytul: 'Dostawa artykułów spożywczych',
      zamawiajacy: 'Szkoła Podstawowa', wartosc_netto: 65000, region: 'mazowieckie',
      link: 'https://bip.pl/odswiez-1', opis: 'zapytanie ofertowe, bez wadium',
    }],
  };
  const fakeUzupelnij = async ({ znalezisko, repo: r }) => {
    r.ustawRegulamin(znalezisko.id, { regulamin_url: 'https://bip.pl/reg-odswiez.pdf', regulamin_streszczenie: 'Oferta w 5 dni.' });
    return { ...znalezisko, regulamin_url: 'https://bip.pl/reg-odswiez.pdf' };
  };
  ustawZrodlaOdswiezania({ adaptery: [fakeAdapter], uzupelnij: fakeUzupelnij });

  // Zapisz preferencję dla tego usera.
  await req('POST', `${P}/preferencje`, { tok: token, body: { branza: 'dostawy', region: 'mazowieckie' } });

  const r = await req('POST', `${P}/odswiez`, { tok: token, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.dodano >= 1, 'dodano nowe ogłoszenie z adaptera');
  assert.ok(r.json.regulaminy >= 1, 'regulamin domówiony');

  // Nowe ogłoszenie jest widoczne w strumieniu i ma regulamin.
  const lista = await req('GET', `${P}/ogloszenia?branza=dostawy`, { tok: token });
  const nowe = lista.json.ogloszenia.find((o) => o.id_zewnetrzny === 'odswiez-1');
  assert.ok(nowe, 'ogłoszenie po odświeżeniu w strumieniu');
  assert.equal(nowe.regulamin_url, 'https://bip.pl/reg-odswiez.pdf');
});

test('POST /odswiez — bez zapisanych preferencji i bez body => 400', async () => {
  const swiezy = users.create({ companyNip: null, companyName: null, email: `podprog-pusty-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  const tok = signToken(swiezy);
  const r = await req('POST', `${P}/odswiez`, { tok, body: {} });
  assert.equal(r.status, 400);
});

test('POST /odswiez — doraźna branża/region z body (bez zapisanej preferencji)', async () => {
  const swiezy = users.create({ companyNip: null, companyName: null, email: `podprog-adhoc-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  const tok = signToken(swiezy);
  const fakeAdapter = {
    zrodlo: 'bip',
    pobierz: async (branza) => [{
      zrodlo: 'bip', id_zewnetrzny: `adhoc-${branza}`, tytul: `Usługa ${branza}`,
      wartosc_netto: 30000, region: 'pomorskie', link: 'https://bip.pl/adhoc', opis: 'zapytanie',
    }],
  };
  ustawZrodlaOdswiezania({ adaptery: [fakeAdapter], uzupelnij: async ({ znalezisko }) => znalezisko });

  const r = await req('POST', `${P}/odswiez`, { tok, body: { branza: 'ochrona', region: 'pomorskie' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.odswiezono, 1, 'jedna doraźna preferencja');
});
