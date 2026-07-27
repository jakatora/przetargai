import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpointy „Symulatora płynności" (podzadanie 4/6 ulepszenia „Symulator płynności:
 * czy udźwigniesz ten kontrakt"). Router `routes/symulatorPlynnosci.js` montowany pod
 * `/api/przetarg/symulator-plynnosci` — spójnie ze wzorcem routera Sejfu/Czarnej
 * skrzynki (samodzielny router, walidacja zod, uwierzytelnienie), ale BEZSTANOWY:
 * spina trzy czyste usługi z kroków 1–3/6 (bez DB, bez płatnego AI).
 *
 * Testujemy PEŁNĄ ŚCIEŻKĘ przez PRAWDZIWĄ aplikację Express:
 *   POST /parametry  (SWZ + umowa → model finansowy),
 *   POST /symulacja  (model + koszty → miesięczne przepływy + luka),
 *   POST /rekomendacje (luka + poduszka → status + konkretne ruchy),
 * oraz SKRÓT POST /analiza (cała ścieżka w jednym kroku) — z twardym niezmiennikiem:
 * /analiza daje ten sam wynik, co ręczne złożenie trzech kroków. Do tego 401 bez
 * tokenu i 400 na błędne wejście.
 */

// ── Setup aplikacji (temp DB dla auth) ───────────────────────────────────────

const DB_FILE = path.join(os.tmpdir(), `przetargai-sp-rt-${process.pid}.db`);
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

const ROOT = `/api/przetarg/symulator-plynnosci`;

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
  return { status: res.status, json: await res.json() };
}

// Deterministyczne wejście: kontrakt na 1,2 mln brutto, JEDNA faktura końcowa, termin
// zapłaty 30 dni, zabezpieczenie 5% wnoszone W PIENIĄDZU, wadium 20 tys., bez zaliczki.
// Daje realną, policzalną lukę pomostową i uzasadnia konkretne ruchy naprawcze.
const SWZ = [
  'Cena brutto oferty wynosi 1 200 000 zł.',
  'Zamawiający żąda wadium w wysokości 20 000 zł.',
  'Rozliczenie następuje jedną fakturą końcową po odbiorze całości robót.',
  'Termin zapłaty faktury wynosi 30 dni od dnia jej doręczenia.',
].join(' ');
const UMOWA = [
  'Wykonawca wniesie zabezpieczenie należytego wykonania umowy w wysokości 5% ceny brutto,',
  'wnoszone w pieniądzu przed podpisaniem umowy.',
].join(' ');

// ══════════════════════════ Auth ══════════════════════════════════════════════

test('POST /parametry — bez tokenu => 401', async () => {
  const { status } = await post(null, '/parametry', { swz: SWZ });
  assert.equal(status, 401);
});

// ══════════════════════════ Pełna ścieżka krok po kroku ═══════════════════════

test('pełna ścieżka: /parametry → /symulacja → /rekomendacje', async () => {
  const token = await zaloz(`sp-pelna-${process.pid}@t.pl`);

  // 1) PARAMETRY — parser wyciąga znormalizowany model finansowy z SWZ + umowy.
  const kp = await post(token, '/parametry', { swz: SWZ, umowa: UMOWA });
  assert.equal(kp.status, 200, JSON.stringify(kp.json));
  const parametry = kp.json.parametry;
  assert.equal(parametry.harmonogramPlatnosci, 'jedna_faktura');
  assert.equal(parametry.terminZaplatyDni, 30);
  assert.equal(parametry.zabezpieczenieProcent, 5);
  assert.equal(parametry.zabezpieczenieForma, 'pieniadz');
  assert.equal(parametry.zaliczkaProcent, 0);
  assert.equal(parametry.wadiumKwota, 20000);
  assert.equal(parametry.cenaBrutto, 1200000);

  // 2) SYMULACJA — model + koszty miesięczne → miesięczne przepływy i luka.
  //    5 mies. × 200 tys. kosztów = 1 mln + 80 tys. blokad (wadium + zabezpieczenie
  //    gotówkowe) wyłożone na starcie; jedna faktura wpływa dopiero w mies. 6.
  const ks = await post(token, '/symulacja', {
    parametry, kosztyMiesieczne: 200000, czasTrwaniaMies: 5,
  });
  assert.equal(ks.status, 200, JSON.stringify(ks.json));
  const symulacja = ks.json.symulacja;
  assert.equal(symulacja.lukaFinansowania, 1080000, 'szczyt ujemnego salda = wyłożony kapitał');
  assert.equal(symulacja.miesiecyPomostowych, 5);
  assert.equal(symulacja.pierwszaWplataMiesiac, 6, 'faktura końcowa + termin 30 dni');
  assert.ok(Array.isArray(symulacja.miesiace) && symulacja.miesiace.length > 0, 'tablica miesięcy');

  // 3) REKOMENDACJE — luka + mała poduszka → status krytyczny i konkretne ruchy.
  const kr = await post(token, '/rekomendacje', {
    lukaFinansowania: symulacja.lukaFinansowania,
    miesiecyPomostowych: symulacja.miesiecyPomostowych,
    poduszkaGotowki: 100000,
    parametry,
  });
  assert.equal(kr.status, 200, JSON.stringify(kr.json));
  const rek = kr.json.rekomendacje;
  assert.equal(rek.status, 'luka_krytyczna', 'poduszka pokrywa < połowy luki');
  assert.equal(rek.brakujeKwota, 980000);
  const typy = rek.ruchy.map((r) => r.typ);
  assert.deepEqual(
    typy,
    ['zabezpieczenie_gwarancja', 'platnosci_czesciowe', 'faktoring'],
    'ruchy dobrane z danych kontraktu (gotówkowe zabezpieczenie + jedna faktura + znana cena)',
  );
  assert.match(rek.komunikat, /finansowania pomostowego/, 'jednozdaniowy wsad do decyzji');
});

// ══════════════════════════ Skrót /analiza ════════════════════════════════════

test('POST /analiza — pełna ścieżka w jednym kroku = złożenie trzech kroków', async () => {
  const token = await zaloz(`sp-analiza-${process.pid}@t.pl`);

  const analiza = await post(token, '/analiza', {
    swz: SWZ, umowa: UMOWA, kosztyMiesieczne: 200000, czasTrwaniaMies: 5, poduszkaGotowki: 100000,
  });
  assert.equal(analiza.status, 200, JSON.stringify(analiza.json));
  assert.ok(analiza.json.parametry && analiza.json.symulacja && analiza.json.rekomendacje, 'trzy sekcje');

  // Ten sam wynik, co ręczne złożenie /parametry → /symulacja → /rekomendacje.
  const p = (await post(token, '/parametry', { swz: SWZ, umowa: UMOWA })).json.parametry;
  const s = (await post(token, '/symulacja', { parametry: p, kosztyMiesieczne: 200000, czasTrwaniaMies: 5 })).json.symulacja;
  const r = (await post(token, '/rekomendacje', {
    lukaFinansowania: s.lukaFinansowania, miesiecyPomostowych: s.miesiecyPomostowych,
    poduszkaGotowki: 100000, parametry: p,
  })).json.rekomendacje;

  assert.deepEqual(analiza.json.parametry, p, 'te same parametry co z /parametry');
  assert.equal(analiza.json.symulacja.lukaFinansowania, s.lukaFinansowania, 'ta sama luka co z /symulacja');
  assert.deepEqual(analiza.json.symulacja.miesiace, s.miesiace, 'te same miesiące');
  assert.equal(analiza.json.rekomendacje.status, r.status, 'ten sam status co z /rekomendacje');
  assert.deepEqual(
    analiza.json.rekomendacje.ruchy.map((x) => x.typ),
    r.ruchy.map((x) => x.typ),
    'te same ruchy',
  );
  assert.equal(analiza.json.rekomendacje.poduszkaGotowki, 100000, 'poduszka przekazana do rekomendacji');
});

// ══════════════════════════ Walidacja wejścia ═════════════════════════════════

test('POST /parametry — brak treści (ani swz, ani umowa) => 400', async () => {
  const token = await zaloz(`sp-pusto-${process.pid}@t.pl`);
  assert.equal((await post(token, '/parametry', {})).status, 400);
  assert.equal((await post(token, '/parametry', { swz: '   ' })).status, 400);
});

test('POST /symulacja — brak modelu "parametry" => 400', async () => {
  const token = await zaloz(`sp-bezmodelu-${process.pid}@t.pl`);
  assert.equal((await post(token, '/symulacja', { kosztyMiesieczne: 1000 })).status, 400);
});

test('POST /rekomendacje — brak/nieliczbowa "lukaFinansowania" => 400', async () => {
  const token = await zaloz(`sp-bezluki-${process.pid}@t.pl`);
  assert.equal((await post(token, '/rekomendacje', { poduszkaGotowki: 5000 })).status, 400);
  assert.equal((await post(token, '/rekomendacje', { lukaFinansowania: 'dużo' })).status, 400);
});

test('POST /analiza — brak treści => 400', async () => {
  const token = await zaloz(`sp-analiza-pusto-${process.pid}@t.pl`);
  assert.equal((await post(token, '/analiza', { kosztyMiesieczne: 1000 })).status, 400);
});
