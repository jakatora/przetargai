import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

/*
 * RODO art. 17 a MOST do Railway (P1, 2026-09-25).
 *
 * Od uruchomienia mostu (P0-4) część danych użytkownika żyje na Railway, na koncie
 * pomostowym: Sejf dokumentów (zaświadczenia KRK, ZUS, US!), Czarna skrzynka,
 * Radar SWZ. `DELETE /auth/me` kasował wyłącznie Firestore — konto pomostowe
 * i wszystko, co na nim leżało, zostawało na zawsze, a użytkownik dostawał
 * „Konto i wszystkie dane zostały trwale usunięte".
 *
 * Kontrakt: jeśli konto ma `most_railway_user_id`, PRZED skasowaniem w Firestore
 * wołamy Railway `DELETE /auth/me`. „Konta nie ma" = sukces (idempotencja).
 * Każdy inny błąd → 503 i konto w Firestore zostaje (wzorem anulowania Stripe).
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config.js');
const { hasloMostu } = await import('../src/services/mostRailway.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const HASLO = 'tajnehaslo123';
let seq = 0;

async function konto({ idRailway = null } = {}) {
  seq++;
  const odp = await oryginalnyFetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `rodo-rw-${process.pid}-${seq}-${Date.now()}@t.pl`, password: HASLO }),
  });
  const dane = await odp.json();
  if (idRailway) await users.ustawMostRailway(dane.user.id, idRailway);
  return { token: dane.token, id: dane.user.id };
}

function odpowiedz(status, dane) {
  const tresc = JSON.stringify(dane);
  return new Response(tresc, { status, headers: { 'content-type': 'application/json' } });
}

/** Fałszywy Railway: zapisuje żądania, odpowiada zaprogramowanie. */
function podstawRailway(odpowiadacz) {
  const zadania = [];
  globalThis.fetch = async (url, opcje = {}) => {
    const adres = String(url);
    if (!adres.startsWith(env.MOST_RAILWAY_URL)) return oryginalnyFetch(url, opcje);
    zadania.push({ adres, metoda: opcje.method, naglowki: opcje.headers ?? {}, cialo: opcje.body ? String(opcje.body) : null });
    return odpowiadacz(adres);
  };
  return zadania;
}

async function usun(token, haslo = HASLO) {
  return oryginalnyFetch(`${BAZA}/auth/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: haslo }),
  });
}

test('konto z mostem: Railway DELETE /auth/me z tokenem konta pomostowego i jego hasłem, potem Firestore', async () => {
  const k = await konto({ idRailway: 'rail-do-usuniecia' });
  const zadania = podstawRailway(() => odpowiedz(200, { ok: true }));

  const odp = await usun(k.token);

  assert.equal(odp.status, 200);
  const doRailway = zadania.filter((z) => z.adres === `${env.MOST_RAILWAY_URL}/auth/me`);
  assert.equal(doRailway.length, 1, 'dane na Railway (Sejf: KRK/ZUS/US) MUSZĄ zostać usunięte');
  assert.equal(doRailway[0].metoda, 'DELETE');
  const token = String(doRailway[0].naglowki.Authorization ?? '').replace('Bearer ', '');
  assert.equal(jwt.verify(token, env.JWT_SECRET).sub, 'rail-do-usuniecia');
  assert.deepEqual(JSON.parse(doRailway[0].cialo), { password: hasloMostu(k.id) });
  assert.equal(await users.findById(k.id), null, 'konto w Firestore usunięte');
});

test('Railway 401 „Konto nie istnieje" = sukces (idempotencja, ponowiona próba)', async () => {
  const k = await konto({ idRailway: 'rail-juz-usuniete' });
  podstawRailway(() => odpowiedz(401, { error: { code: 'UNAUTHORIZED', message: 'Konto nie istnieje' } }));

  const odp = await usun(k.token);

  assert.equal(odp.status, 200);
  assert.equal(await users.findById(k.id), null);
});

test('Railway 404 „Konto nie istnieje" = sukces', async () => {
  const k = await konto({ idRailway: 'rail-404' });
  podstawRailway(() => odpowiedz(404, { error: { code: 'NOT_FOUND', message: 'Konto nie istnieje' } }));

  const odp = await usun(k.token);

  assert.equal(odp.status, 200);
  assert.equal(await users.findById(k.id), null);
});

test('Railway 500 → 503, konto w Firestore NIE jest usuwane', async () => {
  const k = await konto({ idRailway: 'rail-awaria' });
  podstawRailway(() => odpowiedz(500, { error: { code: 'INTERNAL', message: 'boom' } }));

  const odp = await usun(k.token);

  assert.equal(odp.status, 503);
  assert.equal((await odp.json()).error.code, 'SERVICE_UNAVAILABLE');
  assert.ok(await users.findById(k.id), 'bez pewności, że Railway skasował dane, nie wolno obiecać „usunięte"');
});

test('Railway nieosiągalny → 503, konto zostaje', async () => {
  const k = await konto({ idRailway: 'rail-offline' });
  podstawRailway(() => { throw new Error('ECONNREFUSED'); });

  const odp = await usun(k.token);

  assert.equal(odp.status, 503);
  assert.ok(await users.findById(k.id));
});

test('401 z INNYM powodem (zły podpis tokenu) to NIE „konta nie ma" → 503', async () => {
  const k = await konto({ idRailway: 'rail-zly-podpis' });
  podstawRailway(() => odpowiedz(401, { error: { code: 'UNAUTHORIZED', message: 'Nieprawidłowy lub wygasły token' } }));

  const odp = await usun(k.token);

  assert.equal(odp.status, 503);
  assert.ok(await users.findById(k.id));
});

test('404 bez „Konto nie istnieje" (brak trasy na Railway) → 503, dane mogły zostać', async () => {
  const k = await konto({ idRailway: 'rail-brak-trasy' });
  podstawRailway(() => odpowiedz(404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu' } }));

  const odp = await usun(k.token);

  assert.equal(odp.status, 503);
  assert.ok(await users.findById(k.id));
});

test('konto BEZ mostu: Railway nie jest wołany, konto usunięte', async () => {
  const k = await konto();
  const zadania = podstawRailway(() => odpowiedz(500, {}));

  const odp = await usun(k.token);

  assert.equal(odp.status, 200);
  assert.equal(zadania.length, 0);
  assert.equal(await users.findById(k.id), null);
});

test('złe hasło: 403 i Railway nietknięty', async () => {
  const k = await konto({ idRailway: 'rail-zle-haslo' });
  const zadania = podstawRailway(() => odpowiedz(200, { ok: true }));

  const odp = await usun(k.token, 'nie-to-haslo');

  assert.equal(odp.status, 403);
  assert.equal(zadania.length, 0, 'dane na Railway nie mogą zniknąć przez literówkę w haśle');
  assert.ok(await users.findById(k.id));
});
