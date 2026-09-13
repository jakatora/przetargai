import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * ATLAS PILOT (nowy ATLAS) — pytania komputera do telefonu i odpowiedzi z powrotem (`routes/atlasPilot.js`).
 *
 * Osobny od `/api/atlas` (stary ATLAS): tamta rura ma jednego odbiorcę w pamięci.
 * Niezmienniki:
 *  - komputer i telefon uwierzytelniają się własnymi sekretami; serwer trzyma tylko skróty,
 *  - telefon widzi wyłącznie pytania swojego komputera,
 *  - jedna odpowiedź (answer_id) jest przyjęta raz; ta sama z inną treścią → 409,
 *  - „wysłane" tylko wtedy, gdy powiadomienie naprawdę wyszło (bez FCM: notified = []),
 *  - treść odpowiedzi znika z serwera po potwierdzeniu przez komputer.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-atlas-pilot-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const pilot = await import('../src/routes/atlasPilot.js');

let server;
let base;
const pushes = [];

before(() => {
  migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/atlas-pilot`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function call(method, route, { auth, body } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function desktop(name = 'ATLAS') {
  const { status, body } = await call('POST', '/desktop/register', { body: { name } });
  assert.equal(status, 201);
  return `${body.desktop_id}.${body.secret}`;
}

async function phone(desktopAuth, name = 'Telefon') {
  const code = (await call('POST', '/desktop/pairing', { auth: desktopAuth })).body.code;
  const { status, body } = await call('POST', '/device/pair', { body: { code, name } });
  assert.equal(status, 201);
  return `${body.device_id}.${body.token}`;
}

const QUESTION = { key: 'decision:d1:1', kind: 'decision', project_name: 'Remont', text: 'Czy akceptujesz wizję?',
  answers: ['yes', 'no', 'wait'], state: 'open', version: 1 };

test('sekrety chronią wejścia komputera i telefonu; serwer trzyma tylko skróty', async () => {
  assert.equal((await call('GET', '/desktop/answers')).status, 401);
  assert.equal((await call('GET', '/desktop/answers', { auth: 'x.y' })).status, 401);
  assert.equal((await call('GET', '/device/questions', { auth: 'x.y' })).status, 401);
  const auth = await desktop();
  const secret = auth.split('.')[1];
  assert.equal((await call('GET', '/desktop/answers', { auth })).status, 200);
  const dump = JSON.stringify(db.prepare('SELECT * FROM atlas_pilot_desktops').all());
  assert.ok(!dump.includes(secret), 'sekret komputera nie może leżeć w bazie');
});

test('kod parowania działa raz i wygasa; zły kod nie paruje', async () => {
  const auth = await desktop();
  const { code } = (await call('POST', '/desktop/pairing', { auth })).body;
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal((await call('POST', '/device/pair', { body: { code, name: 'A' } })).status, 201);
  assert.equal((await call('POST', '/device/pair', { body: { code, name: 'B' } })).status, 400);
  assert.equal((await call('POST', '/device/pair', { body: { code: 'ZZZZZZZZ', name: 'C' } })).status, 400);
});

test('bez skonfigurowanego FCM pytania trafiają do telefonu, ale nie są oznaczane jako powiadomione', async () => {
  pilot.setPushSender(null);
  const auth = await desktop();
  const device = await phone(auth);
  const put = await call('PUT', '/desktop/questions', { auth, body: { questions: [{ ...QUESTION, notify: true }] } });
  assert.equal(put.status, 200);
  assert.deepEqual({ devices: put.body.devices, notified: put.body.notified, push: put.body.push },
    { devices: 1, notified: [], push: 'unconfigured' });
  const listed = await call('GET', '/device/questions', { auth: device });
  assert.equal(listed.body.questions.length, 1);
  assert.equal(listed.body.questions[0].text, 'Czy akceptujesz wizję?');
});

test('powiadomienie wychodzi raz na pytanie i tylko do telefonów tego komputera', async () => {
  pushes.length = 0;
  pilot.setPushSender(async (tokens, message) => { pushes.push({ tokens, message }); return tokens.length; });
  const auth = await desktop();
  const device = await phone(auth);
  await call('PUT', '/device/push-token', { auth: device, body: { fcm_token: 'tok-1' } });
  const other = await desktop('Inny');
  const otherDevice = await phone(other);
  await call('PUT', '/device/push-token', { auth: otherDevice, body: { fcm_token: 'tok-obcy' } });
  const first = await call('PUT', '/desktop/questions', { auth, body: { questions: [{ ...QUESTION, notify: true }] } });
  assert.deepEqual(first.body.notified, ['decision:d1:1']);
  const again = await call('PUT', '/desktop/questions', { auth, body: { questions: [{ ...QUESTION, notify: true }] } });
  assert.deepEqual(again.body.notified, ['decision:d1:1'], 'już powiadomione pozostaje potwierdzone');
  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0].tokens, ['tok-1']);
  assert.equal(pushes[0].message.data.question_key, 'decision:d1:1');
  assert.equal((await call('GET', '/device/questions', { auth: otherDevice })).body.questions.length, 0);
  pilot.setPushSender(null);
});

test('odpowiedź z telefonu jest przyjęta raz, trafia do komputera i znika po potwierdzeniu', async () => {
  const auth = await desktop();
  const device = await phone(auth);
  await call('PUT', '/desktop/questions', { auth, body: { questions: [{ ...QUESTION, notify: false }] } });
  const answer = { answer_id: 'p-1', question_key: QUESTION.key, payload: { answer: 'yes' } };
  assert.equal((await call('POST', '/device/answers', { auth: device, body: answer })).status, 202);
  const repeat = await call('POST', '/device/answers', { auth: device, body: answer });
  assert.equal(repeat.status, 202);
  assert.equal(repeat.body.status, 'duplicate');
  const conflict = await call('POST', '/device/answers', { auth: device, body: { ...answer, payload: { answer: 'no' } } });
  assert.equal(conflict.status, 409);
  const pending = await call('GET', '/desktop/answers', { auth });
  assert.equal(pending.body.answers.length, 1);
  assert.deepEqual(pending.body.answers[0].payload, { answer: 'yes' });
  await call('POST', '/desktop/answers/ack', { auth, body: { results: [{ answer_id: 'p-1', outcome: 'applied' }] } });
  assert.equal((await call('GET', '/desktop/answers', { auth })).body.answers.length, 0);
  const outcome = await call('GET', '/device/answers/p-1', { auth: device });
  assert.equal(outcome.body.outcome, 'applied');
  const stored = JSON.stringify(db.prepare("SELECT * FROM atlas_pilot_answers WHERE answer_id='p-1'").all());
  assert.ok(!stored.includes('"yes"'), 'treść odpowiedzi usunięta po potwierdzeniu');
  assert.equal((await call('POST', '/device/answers', { auth: device, body: answer })).body.status, 'duplicate');
});

test('odpowiedź na pytanie spoza bieżącej listy jest nieaktualna', async () => {
  const auth = await desktop();
  const device = await phone(auth);
  await call('PUT', '/desktop/questions', { auth, body: { questions: [] } });
  const stale = await call('POST', '/device/answers', { auth: device,
    body: { answer_id: 'p-9', question_key: QUESTION.key, payload: { answer: 'yes' } } });
  assert.equal(stale.status, 410);
});

test('walidacja: zbyt wiele pytań i zły identyfikator odpowiedzi są odrzucane', async () => {
  const auth = await desktop();
  const device = await phone(auth);
  const many = Array.from({ length: 101 }, (_, i) => ({ ...QUESTION, key: `decision:d${i}:1`, notify: false }));
  assert.equal((await call('PUT', '/desktop/questions', { auth, body: { questions: many } })).status, 400);
  await call('PUT', '/desktop/questions', { auth, body: { questions: [{ ...QUESTION, notify: false }] } });
  const bad = await call('POST', '/device/answers', { auth: device,
    body: { answer_id: 'zły id', question_key: QUESTION.key, payload: { answer: 'yes' } } });
  assert.equal(bad.status, 400);
});
