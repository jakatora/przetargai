import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Wysyłka push przez Expo. Kluczowa lekcja (2026-07-28): HTTP 200 z Expo NIE oznacza
 * dostarczenia — realny status jest w każdym BILECIE (`data[].status`). Wcześniej błędy
 * biletów (brak klucza FCM = InvalidCredentials, martwy token = DeviceNotRegistered)
 * ginęły po cichu i „wysłano" kłamało. Te testy pilnują, że liczymy tylko bilety 'ok'.
 */

const { sendPush } = await import('../src/services/push.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('sendPush: pomija tokeny inne niż ExponentPushToken (Expo w ogóle nie wołane)', async () => {
  let wywolano = false;
  globalThis.fetch = async () => { wywolano = true; return { ok: true, json: async () => ({ data: [] }) }; };
  const r = await sendPush(['fcm:abc', 'losowy-string'], { title: 't', body: 'b' });
  assert.equal(r.sent, 0);
  assert.equal(wywolano, false, 'bez ważnych tokenów nie wolno wołać Expo');
});

test('sendPush: liczy TYLKO bilety ok, martwy token raportuje jako błąd', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [
      { status: 'ok', id: 'x' },
      { status: 'error', message: '...', details: { error: 'DeviceNotRegistered' } },
    ] }),
  });
  const r = await sendPush(['ExponentPushToken[A]', 'ExponentPushToken[B]'], { title: 't', body: 'b' });
  assert.equal(r.sent, 1, 'tylko jeden bilet ma status ok');
  assert.equal(r.failed, 1);
  assert.equal(r.bledy.DeviceNotRegistered, 1);
});

test('sendPush: brak klucza FCM (InvalidCredentials) NIE jest liczony jako wysłany', async () => {
  // Dokładny scenariusz z produkcji 2026-07-28 — cały kanał Android padał przez brak klucza FCM.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [
      { status: 'error', message: 'Unable to retrieve the FCM server key...', details: { error: 'InvalidCredentials' } },
    ] }),
  });
  const r = await sendPush('ExponentPushToken[A]', { title: 't', body: 'b' });
  assert.equal(r.sent, 0, 'błąd biletu nie może liczyć się jako wysłany');
  assert.equal(r.failed, 1);
  assert.equal(r.bledy.InvalidCredentials, 1);
});

test('sendPush: HTTP != ok → zero wysłanych, wszystko jako błąd', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const r = await sendPush('ExponentPushToken[A]', { title: 't', body: 'b' });
  assert.equal(r.sent, 0);
  assert.equal(r.failed, 1);
});

test('sendPush: komplet biletów ok → wszystkie policzone', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ status: 'ok' }, { status: 'ok' }] }),
  });
  const r = await sendPush(['ExponentPushToken[A]', 'ExponentPushToken[B]'], { title: 't', body: 'b' });
  assert.equal(r.sent, 2);
  assert.equal(r.failed, 0);
});
