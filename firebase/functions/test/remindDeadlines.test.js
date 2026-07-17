import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Job wysyłający przypomnienia o terminach (D-050). Push podmieniamy atrapą
 * przez moduł — sprawdzamy, że wysyłamy tylko wymagalne, raz, i oznaczamy.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, matches, saved } = await import('../src/db/repos.js');
const pushMod = await import('../src/services/push.js');
const { runReminderCheck } = await import('../src/jobs/remindDeadlines.js');

// Atrapa push — podmieniamy eksport na module (job woła sendPush z tego modułu).
let wyslane = [];
const oryginalnySend = pushMod.sendPush;
beforeEach(() => { wyslane = []; });
// node: nie da się nadpisać named exportu wprost, więc podmieniamy globalThis.fetch
// wewnątrz push.js? Prościej: sendPush używa Expo push API przez fetch — atrapujemy fetch.
const oryginalnyFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('exp.host') || String(url).includes('expo')) {
    wyslane.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) };
  }
  return oryginalnyFetch(url, opts);
};

let seq = 0;
async function userZTokenem(token = 'ExponentPushToken[demo]') {
  seq++;
  const u = await users.create({ email: `job-${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  if (token) await users.setPushToken(u.id, token);
  return u.id;
}
async function zapiszZPrzypomnieniem(userId, deadline) {
  seq++;
  const tenderId = `job-t-${process.pid}-${seq}`;
  const { match } = await matches.create({ userId, tenderId, score: 80, reasoning: 'x', tender: { title: `Przetarg ${seq}`, deadline } });
  await saved.add(userId, match);
  await saved.setReminder(userId, tenderId, true);
  return tenderId;
}

test('wysyła push za wymagalne przypomnienie i oznacza je (nie powtarza)', async () => {
  const userId = await userZTokenem();
  await zapiszZPrzypomnieniem(userId, '2099-01-03T10:00:00.000Z'); // remind_at 2099-01-01

  // Wymuś wymagalność: przesuń remind_at w przeszłość przez ponowne ustawienie
  // NIE — setReminder liczy z „teraz". Zamiast tego sprawdzamy dueReminders z przyszłym „teraz”.
  // Job używa nowIso(), więc dla 2099 nie będzie wymagalny DZIŚ. Podmieniamy remind_at ręcznie:
  const lista = await saved.list(userId);
  // (ustawiamy remind_at na przeszłość, symulując „minęło")
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('users').doc(userId).collection('saved').doc(lista[0].id)
    .update({ remind_at: '2000-01-01T00:00:00.000Z' });

  const wynik = await runReminderCheck();
  assert.equal(wynik.sent, 1, 'jeden push wysłany');
  assert.equal(wyslane.length, 1);
  assert.match(JSON.stringify(wyslane[0]), /składania ofert/i, 'komunikat o zbliżającym się terminie');

  // Drugi przebieg nie powtarza TEGO SAMEGO etapu — advanceReminder przesunął
  // remind_at na kolejny etap (odległa przyszłość dla terminu 2099), więc niewymagalny.
  const wynik2 = await runReminderCheck();
  assert.equal(wynik2.sent, 0, 'ten sam etap się nie powtarza');
});

test('użytkownik bez tokenu: nie wysyłamy, ale oznaczamy (bez pętli)', async () => {
  const userId = await userZTokenem(null); // brak push_token
  await zapiszZPrzypomnieniem(userId, '2099-01-03T10:00:00.000Z');
  const lista = await saved.list(userId);
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('users').doc(userId).collection('saved').doc(lista[0].id)
    .update({ remind_at: '2000-01-01T00:00:00.000Z' });

  const wynik = await runReminderCheck();
  const mojeWyslania = wyslane.length;
  assert.equal(mojeWyslania, 0, 'bez tokenu nie wysyłamy');

  const wynik2 = await runReminderCheck();
  // wpis oznaczony => nie wraca jako wymagalny
  const stillDue = (await saved.dueReminders()).filter((d) => d.userId === userId);
  assert.equal(stillDue.length, 0, 'oznaczony mimo braku tokenu — bez pętli w nieskończoność');
});

test('brak wymagalnych → job kończy się czysto', async () => {
  const wynik = await runReminderCheck();
  assert.equal(wynik.ok, true);
  assert.equal(typeof wynik.due, 'number');
});
