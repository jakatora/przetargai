import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpointy „Radaru planów postępowań" (podzadanie 4/6 ulepszenia „Radar planów
 * postępowań: wiedz o przetargu miesiące przed ogłoszeniem"). Router
 * `routes/radarPlanow.js` montowany pod `/api/przetarg/radar-planow` — spójnie ze
 * wzorcem routera Sejfu/Czarnej skrzynki/Symulatora płynności (samodzielny router,
 * walidacja zod, uwierzytelnienie), ale BEZSTANOWY: spina trzy czyste usługi z kroków
 * 1–3/6 (services/radarPlanow.js, przygotowaniaPlanu.js, zmianyPlanu.js) — bez DB,
 * bez płatnego AI.
 *
 * Testujemy PEŁNĄ ŚCIEŻKĘ przez PRAWDZIWĄ aplikację Express:
 *   POST /dopasuj            (pozycje planu + profil → ranking),
 *   POST /przygotowania      (pozycja + profil → plan przygotowań),
 *   POST /zmiany             (przed/po → lista zmian),
 *   POST /dopasuj-ogloszenie (pozycja + ogłoszenie → pewność + alarm),
 * oraz SKRÓT POST /radar (ranking + przygotowania dla topowych pozycji w jednym kroku)
 * — z twardym niezmiennikiem: /radar daje ten sam ranking co /dopasuj i te same plany
 * co /przygotowania. Do tego 401 bez tokenu i 400 na błędne wejście.
 */

// ── Setup aplikacji (temp DB dla auth) ───────────────────────────────────────

const DB_FILE = path.join(os.tmpdir(), `przetargai-rp-rt-${process.pid}.db`);
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

const ROOT = `/api/przetarg/radar-planow`;

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

// Deterministyczne wejście (dzisiaj wstrzyknięte w profil.dzisiaj — bez Date.now):
//   • profil firmy drogowej z Mazowsza (CPV 45233120-6), potencjał samodzielny 5 mln,
//   • trzy pozycje planu: A (droga, 11.2026, 2 mln), B (materiały biurowe — niepasująca,
//     odcięta poniżej progu), C (droga, 10.2026, 8 mln — przekracza potencjał → konsorcjum).
// Ranking (rosnąco wg terminu wszczęcia, B odcięta): [C, A].
const PROFIL = {
  cpv: ['45233120-6'],
  slowaKluczowe: ['droga', 'nawierzchnia'],
  region: 'mazowieckie',
  dzisiaj: '2026-07-27',
  maksymalnaWartoscKontraktu: 5_000_000,
  posiadaneDokumenty: ['odpis_rejestrowy'],
};

const POZYCJE = [
  {
    id: 'A',
    przedmiot: 'Przebudowa drogi gminnej — nowa nawierzchnia asfaltowa',
    cpv: '45233120-6',
    region: 'mazowieckie',
    terminWszczecia: '2026-11',
    orientacyjnaWartosc: 2_000_000,
  },
  {
    id: 'B',
    przedmiot: 'Dostawa materiałów biurowych do urzędu',
    cpv: '30190000-7',
    region: 'mazowieckie',
    terminWszczecia: '2026-09',
    orientacyjnaWartosc: 50_000,
  },
  {
    id: 'C',
    przedmiot: 'Budowa drogi powiatowej wraz z odwodnieniem',
    cpv: '45233120-6',
    region: 'mazowieckie',
    terminWszczecia: '2026-10',
    orientacyjnaWartosc: 8_000_000,
  },
];

// ══════════════════════════ Auth ══════════════════════════════════════════════

test('POST /dopasuj — bez tokenu => 401', async () => {
  const { status } = await post(null, '/dopasuj', { pozycjePlanow: POZYCJE, profil: PROFIL });
  assert.equal(status, 401);
});

// ══════════════════════════ Dopasuj → przygotowania (krok po kroku) ═══════════

test('pełna ścieżka: /dopasuj → /przygotowania', async () => {
  const token = await zaloz(`rp-pelna-${process.pid}@t.pl`);

  // 1) DOPASUJ — ranking pozycji planu wg terminu wszczęcia, pozycje poniżej progu odcięte.
  const kd = await post(token, '/dopasuj', { pozycjePlanow: POZYCJE, profil: PROFIL });
  assert.equal(kd.status, 200, JSON.stringify(kd.json));
  const ranking = kd.json.ranking;
  assert.ok(Array.isArray(ranking), 'ranking to tablica');
  assert.equal(ranking.length, 2, 'pozycja B (materiały biurowe) odcięta poniżej progu');
  assert.equal(ranking[0].pozycja.id, 'C', 'najbliższy termin (10.2026) na górze');
  assert.equal(ranking[1].pozycja.id, 'A', 'dalszy termin (11.2026) niżej');
  assert.equal(ranking[0].poziom, 'MOCNE', 'dokładne CPV + słowa + region');

  // 2) PRZYGOTOWANIA — plan dla topowej pozycji (C, 8 mln > potencjał 5 mln → konsorcjum).
  const kp = await post(token, '/przygotowania', { pozycja: ranking[0].pozycja, profil: PROFIL });
  assert.equal(kp.status, 200, JSON.stringify(kp.json));
  const plan = kp.json.plan;
  assert.equal(plan.konsorcjum.potrzebnyPartner, true, 'wartość > samodzielny potencjał → partner');
  assert.ok(Array.isArray(plan.kamienieMilowe) && plan.kamienieMilowe.length > 0, 'kamienie milowe');
  assert.match(plan.komunikat, /wszczęcia/, 'jednozdaniowy komunikat startu przygotowań');
});

// ══════════════════════════ Zmiany planu ══════════════════════════════════════

test('POST /zmiany — przesunięcie terminu i wzrost wartości', async () => {
  const token = await zaloz(`rp-zmiany-${process.pid}@t.pl`);
  const PRZED = { terminWszczecia: '2026-10', orientacyjnaWartosc: 2_000_000, cpv: '45233120-6', przedmiot: 'Budowa drogi' };
  const PO = { terminWszczecia: '2026-12', orientacyjnaWartosc: 3_000_000, cpv: '45233120-6', przedmiot: 'Budowa drogi' };

  const kz = await post(token, '/zmiany', { pozycjaPrzed: PRZED, pozycjaPo: PO });
  assert.equal(kz.status, 200, JSON.stringify(kz.json));
  const zmiany = kz.json.zmiany;
  assert.equal(zmiany.length, 2, 'zmiana terminu + zmiana wartości');
  const termin = zmiany.find((z) => z.typ === 'termin');
  assert.equal(termin.kierunek, 'opozniony');
  assert.equal(termin.dni, 61, '01.10 → 01.12 = 61 dni');
  const wartosc = zmiany.find((z) => z.typ === 'wartosc');
  assert.equal(wartosc.kierunek, 'wzrost');
  assert.equal(wartosc.deltaProcent, 50, '2 mln → 3 mln = +50%');
});

// ══════════════════════════ Dopasuj ogłoszenie ════════════════════════════════

test('POST /dopasuj-ogloszenie — ogłoszenie pasuje do pozycji => pewne + alarm', async () => {
  const token = await zaloz(`rp-ogl-${process.pid}@t.pl`);
  const poz = {
    cpv: '45233120-6',
    przedmiot: 'Przebudowa drogi gminnej nowa nawierzchnia',
    orientacyjnaWartosc: 2_000_000,
    terminWszczecia: '2026-11-15',
  };
  const ogloszenie = {
    cpv: '45233120-6',
    przedmiot: 'Przebudowa drogi gminnej — nowa nawierzchnia asfaltowa',
    cena: 2_100_000,
    dataPublikacji: '2026-11-20',
  };

  const ko = await post(token, '/dopasuj-ogloszenie', { pozycja: poz, ogloszenie });
  assert.equal(ko.status, 200, JSON.stringify(ko.json));
  const d = ko.json.dopasowanie;
  assert.equal(d.etykieta, 'pewne', 'CPV + wartość + termin + słowa → pewne');
  assert.equal(d.alarm, true, 'to jest to, na co czekałeś');
  assert.ok(d.pewnosc >= 70, 'pewność powyżej progu PEWNE');
});

// ══════════════════════════ Skrót /radar ══════════════════════════════════════

test('POST /radar — ranking + przygotowania topowych = złożenie /dopasuj i /przygotowania', async () => {
  const token = await zaloz(`rp-radar-${process.pid}@t.pl`);

  const radar = await post(token, '/radar', { pozycjePlanow: POZYCJE, profil: PROFIL });
  assert.equal(radar.status, 200, JSON.stringify(radar.json));
  assert.ok(radar.json.ranking && radar.json.przygotowania, 'dwie sekcje: ranking + przygotowania');

  // Ranking = ten sam co z /dopasuj.
  const dop = await post(token, '/dopasuj', { pozycjePlanow: POZYCJE, profil: PROFIL });
  assert.deepEqual(radar.json.ranking, dop.json.ranking, 'ten sam ranking co z /dopasuj');

  // Przygotowania dla topowych pozycji (domyślny limit ≥ 2 dopasowania) — plan każdej z nich
  // = ten sam, co z osobnego /przygotowania.
  assert.equal(radar.json.przygotowania.length, 2, 'przygotowania dla obu dopasowanych pozycji');
  assert.equal(radar.json.przygotowania[0].pozycja.id, 'C', 'najpilniejsza pozycja pierwsza');
  const prz = await post(token, '/przygotowania', { pozycja: radar.json.ranking[0].pozycja, profil: PROFIL });
  assert.deepEqual(radar.json.przygotowania[0].plan, prz.json.plan, 'ten sam plan co z /przygotowania');
  assert.equal(radar.json.przygotowania[0].plan.konsorcjum.potrzebnyPartner, true, 'C przekracza potencjał');
});

test('POST /radar — limit ogranicza liczbę planów przygotowań', async () => {
  const token = await zaloz(`rp-radar-limit-${process.pid}@t.pl`);
  const radar = await post(token, '/radar', { pozycjePlanow: POZYCJE, profil: PROFIL, limit: 1 });
  assert.equal(radar.status, 200, JSON.stringify(radar.json));
  assert.equal(radar.json.ranking.length, 2, 'ranking pełny niezależnie od limitu');
  assert.equal(radar.json.przygotowania.length, 1, 'przygotowania tylko dla 1 topowej pozycji');
  assert.equal(radar.json.przygotowania[0].pozycja.id, 'C');
});

// ══════════════════════════ Walidacja wejścia ═════════════════════════════════

test('POST /dopasuj — brak "pozycjePlanow" lub "profil" => 400', async () => {
  const token = await zaloz(`rp-dop-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/dopasuj', { profil: PROFIL })).status, 400);
  assert.equal((await post(token, '/dopasuj', { pozycjePlanow: POZYCJE })).status, 400);
});

test('POST /przygotowania — brak "pozycja" => 400', async () => {
  const token = await zaloz(`rp-prz-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/przygotowania', { profil: PROFIL })).status, 400);
});

test('POST /zmiany — brak "pozycjaPo" => 400', async () => {
  const token = await zaloz(`rp-zm-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/zmiany', { pozycjaPrzed: { cpv: '45' } })).status, 400);
});

test('POST /dopasuj-ogloszenie — brak "ogloszenie" => 400', async () => {
  const token = await zaloz(`rp-ogl-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/dopasuj-ogloszenie', { pozycja: { cpv: '45' } })).status, 400);
});

test('POST /radar — brak treści => 400', async () => {
  const token = await zaloz(`rp-radar-400-${process.pid}@t.pl`);
  assert.equal((await post(token, '/radar', { profil: PROFIL })).status, 400);
});
