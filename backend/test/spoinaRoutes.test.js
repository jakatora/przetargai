import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Spoina — pełna ścieżka przez PRAWDZIWĄ aplikację Express (/api/spoina):
 * zakładanie firmy → logowanie kodem → publikacja danych przez biuro → widok i zapis
 * pracownika pod kontrolą ról → synchronizacja różnicowa i na żywo → izolacja firm.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-spoina-rt-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.SPOINA_SMSAPI_TOKEN = ''; // bez bramki SMS — firmy testowe logują się stałym kodem

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const store = await import('../src/services/spoinaStore.js');
const { sendLoginCode } = await import('../src/services/spoinaSms.js');

const ADMIN = process.env.ADMIN_API_KEY;
const ROOT = '/api/spoina';
let server;
let base;

before(() => {
  migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function call(method, sciezka, { token, body, admin } = {}) {
  const res = await fetch(`${base}${ROOT}${sciezka}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(admin ? { 'x-admin-key': admin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Sesja bez przechodzenia przez limiter logowania — do przygotowania danych. */
const sesja = (phone, code) => store.verifyLogin(phone, code).token;
const obj = (json) => (json === null ? null : JSON.parse(json));

const pracownik = (id, name, phone, role, extra = {}) => ({
  id, name, phone, job: 'Spawacz', role, crewId: null, certs: [], docs: [{ kind: 'medical', state: 'valid' }],
  leaveDaysLeft: 20, ice: 'żona', clothing: 'L', lang: 'pl', invited: true, pushOn: true, ...extra,
});

let firma; // { companyId, workerId, biuro (token), mazur (token) }

test('zakładanie firmy wymaga klucza administratora', async () => {
  const dane = { name: 'Spaw-Tech', ownerName: 'Anna Biuro', ownerPhone: '601 100 001', fixedCode: '246810' };
  assert.equal((await call('POST', '/admin/companies', { body: dane })).status, 403);
  assert.equal((await call('POST', '/admin/companies', { body: { name: 'x' }, admin: ADMIN })).status, 400);
  const res = await call('POST', '/admin/companies', { body: dane, admin: ADMIN });
  assert.equal(res.status, 201);
  assert.ok(res.json.companyId);
  firma = res.json;
  const lista = await call('GET', '/admin/companies', { admin: ADMIN });
  assert.equal(lista.json.companies.length, 1);
  assert.equal(lista.json.companies[0].members, 1);
  assert.equal(lista.json.companies[0].fixed_code, true);
  assert.equal(lista.json.sms, false);
});

test('logowanie: ta sama odpowiedź dla znanego i nieznanego numeru, błędny kod = 401', async () => {
  const znany = await call('POST', '/auth/start', { body: { phone: '+48 601 100 001' } });
  const obcy = await call('POST', '/auth/start', { body: { phone: '700 700 700' } });
  assert.deepEqual(znany.json, { ok: true });
  assert.deepEqual(obcy.json, znany.json);
  assert.equal((await call('POST', '/auth/start', { body: { phone: '12' } })).status, 400);

  assert.equal((await call('POST', '/auth/verify', { body: { phone: '601 100 001', code: '000000' } })).status, 401);
  assert.equal((await call('POST', '/auth/verify', { body: { phone: '700 700 700', code: '246810' } })).status, 401);
  const ok = await call('POST', '/auth/verify', { body: { phone: '601100001', code: '246810' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.role, 'office');
  assert.equal(ok.json.companyName, 'Spaw-Tech');
  assert.equal(ok.json.workerId, firma.workerId);
  firma.biuro = ok.json.token;

  const me = await call('GET', '/me', { token: firma.biuro });
  assert.equal(me.json.role, 'office');
  assert.equal((await call('GET', '/me', { token: 'x'.repeat(64) })).status, 401);
  assert.equal((await call('GET', '/docs')).status, 401);
});

test('pięć błędnych kodów blokuje numer na kwadrans — także poprawny kod', async () => {
  store.applyChanges({ companyId: firma.companyId, workerId: firma.workerId, role: 'office' }, {
    'workers/blok': { v: pracownik('blok', 'Bartek Blokada', '601 100 009', 'worker') },
  });
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('POST', '/auth/verify', { body: { phone: '601 100 009', code: `11111${i}` } })).status, 401);
  }
  assert.equal((await call('POST', '/auth/verify', { body: { phone: '601 100 009', code: '246810' } })).status, 429);
  // po upływie blokady poprawny kod znów działa
  assert.ok(store.verifyLogin('601 100 009', '246810', { now: Date.now() + 16 * 60_000 }).token);
});

test('biuro publikuje dane firmy i dostaje numer zmiany', async () => {
  const start = await call('GET', '/docs', { token: firma.biuro });
  assert.equal(start.json.full, true);
  assert.ok(start.json.docs[`workers/${firma.workerId}`]);
  assert.equal(obj(start.json.docs['meta/settings']).companyName, 'Spaw-Tech');

  const res = await call('POST', '/docs', {
    token: firma.biuro,
    body: {
      changes: {
        'workers/mazur': { v: pracownik('mazur', 'Piotr Mazur', '601 100 004', 'worker') },
        'workers/pawlak': { v: pracownik('pawlak', 'Adam Pawlak', '601 100 005', 'worker') },
        'sites/S1': { v: { id: 'S1', name: 'Rurociąg', place: 'Rotterdam', leadId: null, toolroomDone: false, rate: 95, laborCost: 60, dietPerDay: 50, lodgingPerDay: 40, transportCost: 3000, otherCost: 0 } },
        'sites/S2': { v: { id: 'S2', name: 'Hala', place: 'Gdańsk', leadId: null, toolroomDone: false, rate: 80, laborCost: 55, dietPerDay: 0, lodgingPerDay: 0, transportCost: 0, otherCost: 0 } },
        'assignments/a1': { v: { id: 'a1', workerId: 'mazur', siteId: 'S1', roleName: 'Spawacz', status: 'proposed' } },
        'hours/h1': { v: { id: 'h1', workerId: 'mazur', siteId: 'S1', date: '2026-11-04', startMin: 420, endMin: 960, status: 'sent', cardHours: null, byForeman: false } },
        'hours/h2': { v: { id: 'h2', workerId: 'pawlak', siteId: 'S2', date: '2026-11-04', startMin: 420, endMin: 900, status: 'sent', cardHours: null, byForeman: false } },
        'zle/klucz': { v: {} },
      },
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.rejected.map((r) => r.key), ['zle/klucz']);
  assert.equal(obj(res.json.docs['sites/S1']).rate, 95);
  firma.rev = res.json.rev;

  const cisza = await call('GET', `/docs?since=${firma.rev}`, { token: firma.biuro });
  assert.deepEqual(cisza.json, { rev: firma.rev, full: false, docs: {} });
});

test('pracownik loguje się i widzi tylko to, co go dotyczy', async () => {
  firma.mazur = sesja('601 100 004', '246810');
  const res = await call('GET', '/docs', { token: firma.mazur });
  assert.equal(res.json.full, true);
  const d = res.json.docs;
  assert.equal(obj(d['sites/S1']).rate, 0, 'stawka nie trafia na telefon');
  assert.equal(obj(d['sites/S1']).place, 'Rotterdam');
  assert.equal(d['sites/S2'], undefined, 'cudza budowa');
  assert.ok(d['hours/h1']);
  assert.equal(d['hours/h2'], undefined, 'cudze godziny');
  assert.equal(obj(d['workers/mazur']).ice, 'żona');
  assert.equal(obj(d['workers/pawlak']).ice, '');
  assert.deepEqual(obj(d['workers/pawlak']).docs, []);
  assert.equal(obj(d['meta/settings']).marginTarget, undefined);
});

test('zapis pracownika: dozwolone przechodzi, niedozwolone wraca w stanie z serwera', async () => {
  const res = await call('POST', '/docs', {
    token: firma.mazur,
    body: {
      changes: {
        'assignments/a1': { p: { status: 'accepted' } },
        'workers/mazur': { p: { role: 'office' } },
        'hours/h1': { p: { status: 'approved' } },
        'hours/h2': { p: { endMin: 1 } },
        'sites/S1': { p: { rate: 1 } },
      },
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.rejected.map((r) => r.key).sort(), ['hours/h1', 'hours/h2', 'sites/S1', 'workers/mazur']);
  assert.equal(obj(res.json.docs['assignments/a1']).status, 'accepted');
  assert.equal(obj(res.json.docs['workers/mazur']).role, 'worker');
  assert.equal(obj(res.json.docs['hours/h1']).status, 'sent');
  assert.equal(res.json.docs['hours/h2'], null, 'cudzego wpisu serwer nie pokazuje nawet w odpowiedzi');
  assert.equal(obj(res.json.docs['sites/S1']).rate, 0);

  const me = await call('GET', '/me', { token: firma.mazur });
  assert.equal(me.json.role, 'worker');
});

test('biuro dociąga różnicę: zmianę pracownika i usunięcie dokumentu', async () => {
  const roznica = await call('GET', `/docs?since=${firma.rev}`, { token: firma.biuro });
  assert.equal(roznica.json.full, false);
  assert.deepEqual(Object.keys(roznica.json.docs), ['assignments/a1']);
  assert.equal(obj(roznica.json.docs['assignments/a1']).status, 'accepted');

  const usun = await call('POST', '/docs', { token: firma.biuro, body: { changes: { 'hours/h2': null, 'sites/S1': { p: { rate: 99 } } } } });
  assert.equal(usun.json.docs['hours/h2'], null);
  const po = await call('GET', `/docs?since=${roznica.json.rev}`, { token: firma.biuro });
  assert.equal(po.json.docs['hours/h2'], null);
  assert.equal(obj(po.json.docs['sites/S1']).rate, 99);
  assert.equal(obj(po.json.docs['sites/S1']).place, 'Rotterdam', 'zmiana pola nie gubi pozostałych');
  firma.rev = po.json.rev;
});

test('odpytywanie na żywo: połączenie czeka i budzi się przy zmianie w firmie', async () => {
  const start = Date.now();
  const czeka = call('GET', `/docs?since=${firma.rev}&wait=20`, { token: firma.biuro });
  await new Promise((r) => setTimeout(r, 150));
  await call('POST', '/docs', { token: firma.mazur, body: { changes: { 'workers/mazur': { p: { lang: 'uk' } } } } });
  const res = await czeka;
  assert.ok(Date.now() - start < 5000, 'odpowiedź przyszła od razu po zmianie, nie po limicie czasu');
  assert.equal(obj(res.json.docs['workers/mazur']).lang, 'uk');
  assert.ok(res.json.rev > firma.rev);
  firma.rev = res.json.rev;

  const krotko = await call('GET', `/docs?since=${firma.rev}&wait=1`, { token: firma.biuro });
  assert.deepEqual(krotko.json, { rev: firma.rev, full: false, docs: {} });
});

test('przydział odsłania budowę pracownikowi, a usunięcie pracownika zamyka jego sesję', async () => {
  const pawlak = sesja('601 100 005', '246810');
  assert.equal((await call('GET', '/docs', { token: pawlak })).json.docs['sites/S2'], undefined);
  await call('POST', '/docs', {
    token: firma.biuro,
    body: { changes: { 'assignments/a2': { v: { id: 'a2', workerId: 'pawlak', siteId: 'S2', roleName: 'Monter', status: 'proposed' } } } },
  });
  assert.ok((await call('GET', '/docs?since=1', { token: pawlak })).json.docs['sites/S2'], 'budowa pojawia się po przydziale');

  await call('POST', '/docs', { token: firma.biuro, body: { changes: { 'workers/pawlak': null } } });
  assert.equal((await call('GET', '/docs', { token: pawlak })).status, 401);
  assert.equal((await call('POST', '/auth/verify', { body: { phone: '601 100 005', code: '246810' } })).status, 401);
});

test('firmy są od siebie odcięte', async () => {
  const druga = await call('POST', '/admin/companies', {
    admin: ADMIN, body: { name: 'Inna Firma', ownerName: 'Ola Druga', ownerPhone: '602 200 001', fixedCode: '135790' },
  });
  const token = sesja('602 200 001', '135790');
  const docs = (await call('GET', '/docs', { token })).json.docs;
  assert.deepEqual(Object.keys(docs).sort(), ['meta/settings', `workers/${druga.json.workerId}`]);
  // kod jednej firmy nie otwiera drugiej
  assert.throws(() => store.verifyLogin('602 200 001', '246810'));
  // zapis pod kluczem istniejącym w pierwszej firmie tworzy osobny dokument w drugiej
  await call('POST', '/docs', { token, body: { changes: { 'sites/S1': { v: { id: 'S1', name: 'Moja', place: 'Kraków' } } } } });
  const pierwsza = (await call('GET', '/docs', { token: firma.biuro })).json.docs;
  assert.equal(obj(pierwsza['sites/S1']).place, 'Rotterdam');
});

test('wylogowanie unieważnia token', async () => {
  const token = sesja('601 100 004', '246810');
  assert.equal((await call('POST', '/auth/logout', { token })).status, 200);
  assert.equal((await call('GET', '/me', { token })).status, 401);
});

test('kod SMS: jednorazowy, ważny 10 minut, z limitem wysyłek', () => {
  const t0 = Date.now() + 3_600_000;
  const { phone, code } = store.startLogin('601 100 004', { smsReady: true, now: t0 });
  assert.equal(phone, '48601100004');
  assert.match(code, /^\d{6}$/);
  assert.throws(() => store.startLogin('601 100 004', { smsReady: true, now: t0 + 5_000 }), /Odczekaj/);
  assert.throws(() => store.verifyLogin('601 100 004', code, { now: t0 + 11 * 60_000 }), /Błędny kod/);

  const drugi = store.startLogin('601 100 004', { smsReady: true, now: t0 + 12 * 60_000 }).code;
  assert.ok(store.verifyLogin('601 100 004', drugi, { now: t0 + 13 * 60_000 }).token);
  assert.throws(() => store.verifyLogin('601 100 004', drugi, { now: t0 + 14 * 60_000 }), /Błędny kod/, 'kod działa raz');

  // nieznany numer: brak kodu do wysłania, ale licznik próśb działa tak samo
  assert.equal(store.startLogin('799 999 999', { smsReady: true, now: t0 }).code, null);
  for (let i = 1; i <= 4; i++) store.startLogin('799 999 999', { smsReady: true, now: t0 + i * 31_000 });
  assert.throws(() => store.startLogin('799 999 999', { smsReady: true, now: t0 + 5 * 31_000 }), /za godzinę/);
});

test('bramka SMS: poprawne żądanie do SMSAPI i błąd przy odmowie', async () => {
  const wyslane = [];
  const fetchOk = async (url, init) => {
    wyslane.push({ url, auth: init.headers.Authorization, body: Object.fromEntries(init.body) });
    return { ok: true, status: 200, json: async () => ({ count: 1, list: [{ id: '1' }] }) };
  };
  await sendLoginCode('48601100004', '123456', { fetchImpl: fetchOk, token: 'tok', from: 'Spoina' });
  assert.equal(wyslane[0].url, 'https://api.smsapi.pl/sms.do');
  assert.equal(wyslane[0].auth, 'Bearer tok');
  assert.equal(wyslane[0].body.to, '48601100004');
  assert.equal(wyslane[0].body.from, 'Spoina');
  assert.match(wyslane[0].body.message, /123456/);
  assert.doesNotMatch(wyslane[0].body.message, /[^\x00-\x7f]/, 'bez polskich znaków — jeden SMS');

  const fetchZle = async () => ({ ok: true, status: 200, json: async () => ({ error: 103, message: 'Brak punktów' }) });
  await assert.rejects(sendLoginCode('48601100004', '123456', { fetchImpl: fetchZle, token: 'tok' }), /SMSAPI/);
  await assert.rejects(sendLoginCode('48601100004', '123456', { fetchImpl: fetchOk, token: '' }), /wyłączona/);
});

test('numer telefonu: jedna postać niezależnie od zapisu', () => {
  assert.equal(store.canonPhone('601 204 118'), '48601204118');
  assert.equal(store.canonPhone('+48 601-204-118'), '48601204118');
  assert.equal(store.canonPhone('0048601204118'), '48601204118');
  assert.equal(store.canonPhone('+380 67 123 45 67'), '380671234567');
  assert.equal(store.canonPhone('12345'), '');
  assert.equal(store.canonPhone(null), '');
});
