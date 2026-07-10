import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * E2 — naprawa P-4 (utrata przetargów) + re-ocena po zmianie profilu.
 *
 * Stan przed naprawą: `runTenderFetch` dopasowywał wyłącznie ogłoszenia pobrane
 * w bieżącym cyklu. Konto Free z limitem dziennym traciło nadwyżkę BEZPOWROTNIE —
 * w następnym cyklu te przetargi nie były już „nowe". Zmierzone: brukarz miał 11
 * dopasowań ≥60%, zobaczył 5, pozostałych 6 nie zobaczyłby nigdy.
 *
 * Naprawa: pula kandydatów = przetargi z otwartym terminem BEZ wiersza w `matches`
 * dla danego usera. Limit dzienny ODRACZA na jutro zamiast kasować.
 *
 * Kontrola kosztów AI (spójna z §5 planu): pulę rankuje darmowa heurystyka,
 * AI ocenia wyłącznie czołówkę (AI_RERANK_TOP_N) — bez tego przetarg oceniony
 * poniżej progu wracałby do płatnego AI codziennie aż do deadline'u.
 */

// Konfiguracja PRZED dynamicznymi importami (moduł config czyta process.env raz).
const DB_FILE = path.join(os.tmpdir(), `przetargai-pool-test-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = ''; // testy nie wołają prawdziwego API
process.env.FREE_TIER_DAILY_MATCH_LIMIT = '1';
process.env.MATCH_CONFIDENCE_THRESHOLD = '60';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { users, tenders, matches } = await import('../src/db/repos.js');
const { generateMatchesForUser, backfillUser } = await import('../src/services/matching.js');

before(() => migrate());
after(() => {
  db.close();
  fs.rmSync(DB_FILE, { force: true });
});

let seq = 0;
function addTender({ title, deadline = '2099-12-31T23:59:59', cpvMain = null }) {
  seq++;
  const { tender } = tenders.upsert({
    externalId: `ext-${seq}`,
    title,
    organization: 'Gmina Testowo',
    cpvMain,
    deadline,
    url: `https://example.gov.pl/${seq}`,
    raw: {},
    publishedAt: '2026-07-01T08:00:00',
  });
  // Deterministyczna kolejność puli (upsert nadaje wszystkim ten sam fetched_at).
  db.prepare('UPDATE tenders SET fetched_at = ? WHERE id = ?')
    .run(`2026-07-0${Math.min(9, seq)}T00:00:00.000Z`, tender.id);
  return tenders.findById(tender.id);
}

async function addUser({ email, keywords, cpvCodes = [] }) {
  return users.create({
    companyNip: String(1000000000 + seq++ * 7),
    companyName: `Firma ${email}`,
    email,
    passwordHash: 'x'.repeat(60),
    keywords,
    cpvCodes,
  });
}

/** Symuluje „następny dzień": budżet dzienny liczy się z created_at dopasowań. */
function przewinDzien() {
  db.prepare("UPDATE matches SET created_at = '2020-01-01T00:00:00.000Z'").run();
}

// ---------------- tenders.candidatesForUser ----------------

test('pula: nie zawiera przetargów już dopasowanych dla TEGO usera, ale innym ich nie chowa', async () => {
  const userA = await addUser({ email: 'a@test.pl', keywords: ['droga'] });
  const userB = await addUser({ email: 'b@test.pl', keywords: ['droga'] });
  const t = addTender({ title: 'Budowa drogi gminnej' });

  matches.create({ userId: userA.id, tenderId: t.id, score: 80, reasoning: 'x', scorer: 'heuristic' });

  const poolA = tenders.candidatesForUser(userA.id, 100);
  const poolB = tenders.candidatesForUser(userB.id, 100);
  assert.ok(!poolA.some((x) => x.id === t.id), 'dopasowany przetarg nie powinien wrócić do puli usera A');
  assert.ok(poolB.some((x) => x.id === t.id), 'dopasowanie usera A nie może chować przetargu userowi B');
});

test('pula: odrzuca przetargi po terminie, zostawia z terminem otwartym i bez terminu', async () => {
  const user = await addUser({ email: 'c@test.pl', keywords: ['droga'] });
  const przeszly = addTender({ title: 'Po terminie', deadline: '2020-01-01T00:00:00' });
  const otwarty = addTender({ title: 'Otwarty termin' });
  const bezTerminu = addTender({ title: 'Bez terminu', deadline: null });

  const pool = tenders.candidatesForUser(user.id, 100);
  const ids = pool.map((x) => x.id);
  assert.ok(!ids.includes(przeszly.id), 'przetarg po terminie nie jest kandydatem');
  assert.ok(ids.includes(otwarty.id));
  assert.ok(ids.includes(bezTerminu.id), 'brak terminu nie może wykluczać z puli');
});

test('pula: respektuje limit i sortuje od najświeższych (fetched_at DESC)', async () => {
  const user = await addUser({ email: 'd@test.pl', keywords: ['droga'] });
  const pool = tenders.candidatesForUser(user.id, 2);
  assert.equal(pool.length, 2);
  assert.ok(pool[0].fetched_at >= pool[1].fetched_at, 'pierwszy ma być najświeższy');
});

// ---------------- generateMatchesForUser — P-4 ----------------

test('P-4: limit dzienny 1 ODRACZA przetargi — 3 dni × pula = 3 dopasowania, zero strat', async () => {
  const user = await addUser({ email: 'brukarz@test.pl', keywords: ['kostka'] });
  addTender({ title: 'Ułożenie kostki brukowej — rynek' });
  addTender({ title: 'Kostka brukowa na parkingu szkoły' });
  addTender({ title: 'Remont chodnika z kostki betonowej' });

  let total = 0;
  for (let dzien = 1; dzien <= 3; dzien++) {
    const pool = tenders.candidatesForUser(user.id, 100);
    const r = await generateMatchesForUser(user, pool);
    total += r.created;
    assert.equal(r.created, 1, `dzień ${dzien}: limit 1 → dokładnie 1 nowe dopasowanie`);
    przewinDzien();
  }
  assert.equal(total, 3, 'żaden przetarg nie przepadł — wszystkie 3 dotarły do usera');

  const tenderIds = db.prepare(
    'SELECT DISTINCT tender_id FROM matches WHERE user_id = ?',
  ).all(user.id);
  assert.equal(tenderIds.length, 3, 'trzy RÓŻNE przetargi, bez duplikatów');
});

test('ranking: przy budżecie 1 wygrywa kandydat z NAJWYŻSZĄ heurystyką, nie pierwszy z brzegu', async () => {
  const user = await addUser({
    email: 'ranking@test.pl',
    keywords: ['droga', 'asfalt', 'chodnik'],
  });
  // Słabszy kandydat celowo pierwszy w puli (świeższy fetched_at nadaje addTender).
  const slabszy = addTender({ title: 'Remont drogi asfaltowej' });          // 2/3 ≈ 67
  const mocniejszy = addTender({ title: 'Remont drogi asfaltowej z chodnikiem' }); // 3/3 = 100

  const pool = tenders.candidatesForUser(user.id, 100);
  const r = await generateMatchesForUser(user, pool);
  assert.equal(r.created, 1);

  const created = db.prepare(
    'SELECT tender_id, confidence_score FROM matches WHERE user_id = ?',
  ).all(user.id);
  assert.equal(created[0].tender_id, mocniejszy.id, 'budżet ma iść na najlepsze dopasowanie');
  assert.ok(!created.some((m) => m.tender_id === slabszy.id));
});

test('bez klucza AI wszystkie oceny są heurystyczne (żadnych wywołań API w testach)', async () => {
  const scorers = db.prepare('SELECT DISTINCT scorer FROM matches').all().map((r) => r.scorer);
  for (const s of scorers) assert.equal(s, 'heuristic');
});

// ---------------- backfillUser — rejestracja i zmiana profilu ----------------

test('backfillUser: nowe kryteria natychmiast dopasowują ISTNIEJĄCE przetargi', async () => {
  // Scenariusz z planu §6.14: user dopisuje słowo kluczowe i musi zobaczyć efekt
  // na ogłoszeniach opublikowanych PRZED zmianą profilu.
  addTender({ title: 'Wycinka drzew przy drodze wojewódzkiej' });
  const user = await addUser({ email: 'e@test.pl', keywords: ['wycinka'] });

  const r = await backfillUser(user);
  assert.ok(r.created >= 1, 'backfill ma utworzyć dopasowanie do starego ogłoszenia');
});

test('backfillUser: user bez kryteriów = zero pracy, zero błędów', async () => {
  const user = await addUser({ email: 'f@test.pl', keywords: [] });
  const r = await backfillUser(user);
  assert.deepEqual(r, { created: 0, evaluated: 0 });
});
