import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

/*
 * Powiązanie analizy SWZ (Radar SWZ, Railway) z KONKRETNYM przetargiem
 * (audyt 2026-09-29, usterka 2).
 *
 * Checklista „co musisz mieć do dnia składania" nigdy nie dostawała wymagań:
 * ekran czekał na `postepowanieId`, którego żadna ścieżka UI nie podawała, a
 * przetarg nie miał żadnego trwałego związku z analizą SWZ. Teraz użytkownik
 * wskazuje analizę dla przetargu, a Functions zapisuje to w JEGO zakresie
 * (users/{uid}/powiazania_swz/{tenderId}) — dopiero po sprawdzeniu przez most,
 * że analiza należy do niego. Bez zgadywania po tytule.
 */

process.env.ANTHROPIC_API_KEY = '';
// Most jawnie, na atrapę Railway na loopback (tryb lokalny nie pozwala na więcej).
process.env.MOST_ENABLED = 'true';
process.env.MOST_RAILWAY_URL = 'http://127.0.0.1:39125';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { users, tenders } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { env } = await import('../src/config.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

let licznik = 0;
async function zalozUzytkownika() {
  licznik += 1;
  const user = await users.create({ email: `swz-${process.pid}-${licznik}@test.invalid`, passwordHash: 'x' });
  return { user, token: signToken(user.id, 0) };
}

async function zalozPrzetarg(nazwa) {
  licznik += 1;
  const { tender } = await tenders.upsert({
    externalId: `2026/BZP 0077${process.pid % 1000}${licznik}/01`,
    title: nazwa,
    deadline: '2099-01-10T09:00:00.000Z',
  });
  return tender;
}

/**
 * Atrapa Railway: konta pomostowe + analizy SWZ przypisane do kont.
 * `wlasnosc` mapuje e-mail konta pomostowego (most.<uid>@…) na listę jego analiz.
 */
function podstawRailway({ analizyUzytkownika = {}, awaria = false } = {}) {
  const zadania = [];
  const idPoEmailu = new Map();
  globalThis.fetch = async (url, opcje = {}) => {
    const adres = String(url);
    if (!adres.startsWith(env.MOST_RAILWAY_URL)) return oryginalnyFetch(url, opcje);
    const sciezka = new URL(adres).pathname;
    zadania.push({ metoda: opcje.method ?? 'GET', sciezka });
    if (awaria) throw new Error('ECONNREFUSED (atrapa)');

    if (sciezka === '/auth/register') {
      const { email } = JSON.parse(opcje.body);
      const id = `rw-${idPoEmailu.size + 1}`;
      idPoEmailu.set(id, email);
      return Response.json({ user: { id } }, { status: 201 });
    }
    const dopasowanie = sciezka.match(/^\/api\/przetarg\/swz\/postepowania\/([^/]+)$/);
    if (dopasowanie) {
      const { sub } = jwt.verify(opcje.headers.Authorization.slice(7), env.JWT_SECRET);
      const email = idPoEmailu.get(sub) ?? '';
      const uid = email.slice('most.'.length, email.indexOf('@'));
      const analiza = (analizyUzytkownika[uid] ?? []).find((a) => a.id === dopasowanie[1]);
      if (!analiza) return Response.json({ error: { message: 'Nie znaleziono postępowania.' } }, { status: 404 });
      return Response.json({ postepowanie: { id: analiza.id, nazwa: analiza.nazwa } }, { status: 200 });
    }
    return Response.json({ error: 'atrapa: nieobsługiwana ścieżka' }, { status: 500 });
  };
  return zadania;
}

async function zapytaj(port, metoda, sciezka, token, cialo) {
  const odp = await fetch(`http://127.0.0.1:${port}${sciezka}`, {
    method: metoda,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cialo ? JSON.stringify(cialo) : undefined,
  });
  return { status: odp.status, dane: await odp.json().catch(() => null) };
}

async function zSerwerem(fn) {
  const serwer = createApp().listen(0);
  try { return await fn(serwer.address().port); } finally { serwer.close(); }
}

test('powiązanie własnej analizy SWZ z przetargiem jest trwałe i wraca w GET', async () => {
  const a = await zalozUzytkownika();
  const przetarg = await zalozPrzetarg('Przebudowa chodnika');
  const zadania = podstawRailway({ analizyUzytkownika: { [a.user.id]: [{ id: 'p-a1', nazwa: 'SWZ chodnik Lipowa' }] } });

  await zSerwerem(async (port) => {
    const put = await zapytaj(port, 'PUT', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token, { postepowanie_id: 'p-a1' });
    assert.equal(put.status, 200);
    assert.equal(put.dane.powiazanie.postepowanie_id, 'p-a1');
    assert.equal(put.dane.powiazanie.nazwa, 'SWZ chodnik Lipowa');

    const get = await zapytaj(port, 'GET', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token);
    assert.equal(get.status, 200);
    assert.equal(get.dane.powiazanie.postepowanie_id, 'p-a1');
  });
  assert.ok(zadania.some((z) => z.sciezka === '/api/przetarg/swz/postepowania/p-a1'),
    'własność analizy sprawdzona przez most');
});

test('cudza analiza SWZ: 404 i nic się nie zapisuje', async () => {
  const a = await zalozUzytkownika();
  const b = await zalozUzytkownika();
  const przetarg = await zalozPrzetarg('Remont drogi');
  podstawRailway({ analizyUzytkownika: { [b.user.id]: [{ id: 'p-b1', nazwa: 'SWZ cudza' }] } });

  await zSerwerem(async (port) => {
    const put = await zapytaj(port, 'PUT', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token, { postepowanie_id: 'p-b1' });
    assert.equal(put.status, 404);
    const get = await zapytaj(port, 'GET', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token);
    assert.equal(get.dane.powiazanie, null);
  });
});

test('powiązanie jednego użytkownika jest niewidoczne dla innego', async () => {
  const a = await zalozUzytkownika();
  const b = await zalozUzytkownika();
  const przetarg = await zalozPrzetarg('Budowa sali');
  podstawRailway({ analizyUzytkownika: { [a.user.id]: [{ id: 'p-a2', nazwa: 'SWZ sala' }] } });

  await zSerwerem(async (port) => {
    assert.equal((await zapytaj(port, 'PUT', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token, { postepowanie_id: 'p-a2' })).status, 200);
    const getB = await zapytaj(port, 'GET', `/wygrywalnosc/tender/${przetarg.id}/swz`, b.token);
    assert.equal(getB.status, 200);
    assert.equal(getB.dane.powiazanie, null);
  });
});

test('powiązanie dotyczy tylko wskazanego przetargu', async () => {
  const a = await zalozUzytkownika();
  const x = await zalozPrzetarg('Przetarg X');
  const y = await zalozPrzetarg('Przetarg Y');
  podstawRailway({ analizyUzytkownika: { [a.user.id]: [{ id: 'p-a3', nazwa: 'SWZ X' }] } });

  await zSerwerem(async (port) => {
    assert.equal((await zapytaj(port, 'PUT', `/wygrywalnosc/tender/${x.id}/swz`, a.token, { postepowanie_id: 'p-a3' })).status, 200);
    assert.equal((await zapytaj(port, 'GET', `/wygrywalnosc/tender/${y.id}/swz`, a.token)).dane.powiazanie, null);
  });
});

test('nieistniejący przetarg: 404 bez ruchu do Railway', async () => {
  const a = await zalozUzytkownika();
  const zadania = podstawRailway();
  await zSerwerem(async (port) => {
    const put = await zapytaj(port, 'PUT', '/wygrywalnosc/tender/nie-ma-takiego/swz', a.token, { postepowanie_id: 'p-1' });
    assert.equal(put.status, 404);
  });
  assert.deepEqual(zadania, []);
});

test('niepoprawny identyfikator analizy: 400 bez ruchu do Railway', async () => {
  const a = await zalozUzytkownika();
  const przetarg = await zalozPrzetarg('Przetarg Z');
  const zadania = podstawRailway();
  await zSerwerem(async (port) => {
    for (const zly of ['', '../auth/me', 'a/b', ' ', 'x'.repeat(101)]) {
      const put = await zapytaj(port, 'PUT', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token, { postepowanie_id: zly });
      assert.equal(put.status, 400, `identyfikator ${JSON.stringify(zly)}`);
    }
  });
  assert.deepEqual(zadania, []);
});

test('awaria mostu przy powiązaniu: 502 i nic się nie zapisuje', async () => {
  const a = await zalozUzytkownika();
  const przetarg = await zalozPrzetarg('Przetarg awaria');
  podstawRailway({ awaria: true });
  await zSerwerem(async (port) => {
    const put = await zapytaj(port, 'PUT', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token, { postepowanie_id: 'p-a9' });
    assert.equal(put.status, 502);
    assert.equal((await zapytaj(port, 'GET', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token)).dane.powiazanie, null);
  });
});

test('odłączenie analizy usuwa powiązanie', async () => {
  const a = await zalozUzytkownika();
  const przetarg = await zalozPrzetarg('Przetarg do odłączenia');
  podstawRailway({ analizyUzytkownika: { [a.user.id]: [{ id: 'p-a4', nazwa: 'SWZ' }] } });
  await zSerwerem(async (port) => {
    await zapytaj(port, 'PUT', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token, { postepowanie_id: 'p-a4' });
    const del = await zapytaj(port, 'DELETE', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token);
    assert.equal(del.status, 200);
    assert.equal((await zapytaj(port, 'GET', `/wygrywalnosc/tender/${przetarg.id}/swz`, a.token)).dane.powiazanie, null);
  });
});
