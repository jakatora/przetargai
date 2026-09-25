import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Wynik wysyłki push nie może ginąć (P1, 2026-09-25).
 *
 *  • Martwy token (Expo: DeviceNotRegistered — aplikacja odinstalowana) zostawał
 *    na koncie na zawsze: każdy cykl płacił za wysyłkę w próżnię, a logi zalewał
 *    ten sam błąd. Teraz sendPush wskazuje martwe tokeny i zdejmuje je z bazy.
 *  • Silnik dopasowań oznaczał dopasowania jako „powiadomione", nawet gdy NIC nie
 *    doszło (sent === 0). Znacznik ma mówić prawdę — tylko po realnej dostawie.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { getFirestore } = await import('firebase-admin/firestore');
const { users, tenders } = await import('../src/db/repos.js');
const { sendPush } = await import('../src/services/push.js');
const { generateMatchesForUser } = await import('../src/services/matching.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

let seq = 0;
const unikalny = () => `${process.pid}-${++seq}-${Date.now()}`;

async function kontoZTokenem(token, keywords = []) {
  const u = await users.create({ email: `mt-${unikalny()}@t.pl`, passwordHash: 'h', keywords });
  await users.setPushToken(u.id, token);
  return users.findById(u.id);
}

async function przetarg(title) {
  const { tender } = await tenders.upsert({
    externalId: `mt-${unikalny()}`, title, organization: 'Gmina Testowa', deadline: '2099-01-01T00:00:00.000Z',
  });
  return tender;
}

async function znacznikiPowiadomienia(userId) {
  const snap = await getFirestore().collection('users').doc(userId).collection('matches').get();
  return snap.docs.map((d) => d.data().notified);
}

/** Atrapa Expo: bilety w kolejności wiadomości, wg mapy token → kod błędu. */
function podstawExpo(bledyTokenow) {
  globalThis.fetch = async (url, opcje) => {
    if (!String(url).includes('exp.host')) return oryginalnyFetch(url, opcje);
    const wiadomosci = JSON.parse(opcje.body);
    return {
      ok: true,
      json: async () => ({
        data: wiadomosci.map(({ to }) => (bledyTokenow[to]
          ? { status: 'error', message: '...', details: { error: bledyTokenow[to] } }
          : { status: 'ok', id: `bilet-${to}` })),
      }),
    };
  };
}

test('DeviceNotRegistered od Expo → token zdjęty z konta w bazie', async () => {
  const martwy = `ExponentPushToken[martwy-${unikalny()}]`;
  const zywy = `ExponentPushToken[zywy-${unikalny()}]`;
  const a = await kontoZTokenem(martwy);
  const b = await kontoZTokenem(zywy);
  podstawExpo({ [martwy]: 'DeviceNotRegistered' });

  const wynik = await sendPush([martwy, zywy], { title: 't', body: 'b' });

  assert.equal(wynik.sent, 1);
  assert.equal(wynik.bledy.DeviceNotRegistered, 1);
  assert.deepEqual(wynik.martweTokeny, [martwy]);
  assert.equal((await users.findById(a.id)).push_token, null, 'martwy token musi zniknąć z konta');
  assert.equal((await users.findById(b.id)).push_token, zywy, 'żywego tokenu nie wolno ruszać');
});

test('InvalidCredentials (klucz FCM po naszej stronie) NIE kasuje tokenu użytkownika', async () => {
  const token = `ExponentPushToken[fcm-${unikalny()}]`;
  const a = await kontoZTokenem(token);
  podstawExpo({ [token]: 'InvalidCredentials' });

  const wynik = await sendPush(token, { title: 't', body: 'b' });

  assert.equal(wynik.sent, 0);
  assert.equal((await users.findById(a.id)).push_token, token);
});

test('dopasowania: wstrzyknięty wynik {sent:0, DeviceNotRegistered} → token wyczyszczony, NIE „powiadomiono"', async () => {
  const token = `ExponentPushToken[dm-${unikalny()}]`;
  const user = await kontoZTokenem(token, ['chodnik']);
  const pula = [await przetarg('Budowa chodnika przy szkole')];

  const wynik = await generateMatchesForUser(user, pula, {
    wyslijPush: async () => ({ sent: 0, failed: 1, bledy: { DeviceNotRegistered: 1 } }),
  });

  assert.equal(wynik.created, 1, 'warunek testu: heurystyka tworzy dopasowanie');
  assert.equal((await users.findById(user.id)).push_token, null,
    'martwy token musi zniknąć — inaczej każdy cykl płaci za wysyłkę w próżnię');
  assert.deepEqual(await znacznikiPowiadomienia(user.id), [0],
    'push nie doszedł — dopasowanie NIE może być oznaczone jako powiadomione');
});

test('dopasowania: prawdziwa wysyłka z martwym tokenem (Expo) — token zdjęty, brak znacznika', async () => {
  const token = `ExponentPushToken[dmx-${unikalny()}]`;
  const user = await kontoZTokenem(token, ['chodnik']);
  const pula = [await przetarg('Remont chodnika gminnego')];
  podstawExpo({ [token]: 'DeviceNotRegistered' });

  await generateMatchesForUser(user, pula);

  assert.equal((await users.findById(user.id)).push_token, null);
  assert.deepEqual(await znacznikiPowiadomienia(user.id), [0]);
});

test('dopasowania: sent>0 → dopasowania oznaczone jako powiadomione', async () => {
  const token = `ExponentPushToken[ok-${unikalny()}]`;
  const user = await kontoZTokenem(token, ['chodnik']);
  const pula = [await przetarg('Przebudowa chodnika w centrum')];

  await generateMatchesForUser(user, pula, {
    wyslijPush: async () => ({ sent: 1, failed: 0, bledy: {} }),
  });

  assert.deepEqual(await znacznikiPowiadomienia(user.id), [1]);
  assert.equal((await users.findById(user.id)).push_token, token);
});

test('dopasowania: rzucający nadawca push nie wywraca cyklu użytkownika', async () => {
  const token = `ExponentPushToken[rzut-${unikalny()}]`;
  const user = await kontoZTokenem(token, ['chodnik']);
  const pula = [await przetarg('Naprawa chodnika na osiedlu')];

  const wynik = await generateMatchesForUser(user, pula, {
    wyslijPush: async () => { throw new Error('Expo padło'); },
  });

  assert.equal(wynik.created, 1, 'dopasowania już zapisane — awaria pusha ich nie cofa');
  assert.deepEqual(await znacznikiPowiadomienia(user.id), [0]);
});
