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
  const zdjete = [];
  const r = await sendPush(['ExponentPushToken[A]', 'ExponentPushToken[B]'], { title: 't', body: 'b' },
    { zdejmijMartwe: async (tokeny) => { zdjete.push(...tokeny); } });
  assert.equal(r.sent, 1, 'tylko jeden bilet ma status ok');
  assert.equal(r.failed, 1);
  assert.equal(r.bledy.DeviceNotRegistered, 1);
  // 2026-09-25: martwy token jest WSKAZANY (bilety idą w kolejności wiadomości) i sprzątany.
  assert.deepEqual(r.martweTokeny, ['ExponentPushToken[B]']);
  assert.deepEqual(zdjete, ['ExponentPushToken[B]'], 'martwy token musi zniknąć z bazy');
});

test('sendPush: martwy token z `details.expoPushToken` ma pierwszeństwo przed pozycją biletu', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [
      { status: 'error', details: { error: 'DeviceNotRegistered', expoPushToken: 'ExponentPushToken[B]' } },
      { status: 'ok' },
    ] }),
  });
  const r = await sendPush(['ExponentPushToken[A]', 'ExponentPushToken[B]'], { title: 't', body: 'b' },
    { zdejmijMartwe: async () => {} });
  assert.deepEqual(r.martweTokeny, ['ExponentPushToken[B]']);
});

test('sendPush: awaria sprzątania martwych tokenów nie wywraca wysyłki', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
  });
  const r = await sendPush('ExponentPushToken[A]', { title: 't', body: 'b' },
    { zdejmijMartwe: async () => { throw new Error('Firestore padł'); } });
  assert.equal(r.sent, 0);
  assert.deepEqual(r.martweTokeny, ['ExponentPushToken[A]']);
});

test('sendPush: brak klucza FCM (InvalidCredentials) NIE jest liczony jako wysłany', async () => {
  // Dokładny scenariusz z produkcji 2026-07-28 — cały kanał Android padał przez brak klucza FCM.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [
      { status: 'error', message: 'Unable to retrieve the FCM server key...', details: { error: 'InvalidCredentials' } },
    ] }),
  });
  let sprzatano = false;
  const r = await sendPush('ExponentPushToken[A]', { title: 't', body: 'b' },
    { zdejmijMartwe: async () => { sprzatano = true; } });
  assert.equal(r.sent, 0, 'błąd biletu nie może liczyć się jako wysłany');
  assert.equal(r.failed, 1);
  assert.equal(r.bledy.InvalidCredentials, 1);
  // Błąd PO NASZEJ stronie (klucz FCM) nie jest winą telefonu — token zostaje.
  assert.deepEqual(r.martweTokeny, []);
  assert.equal(sprzatano, false, 'ważnego tokenu nie wolno kasować przez problem z kluczem serwera');
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
