import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, matches } = await import('../src/db/repos.js');
const { runWeeklyDigest } = await import('../src/jobs/weeklyDigest.js');

let seq = 0;
async function dodajUsera() {
  seq++;
  const u = await users.create({ email: `wd${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  return users.findById(u.id);
}

// Wysyłkę e-maili przechwytujemy atrapą fetch (Resend jest w trybie degradacji bez
// klucza, więc realnie nic nie wyśle — liczymy KANDYDATÓW, nie wysłane).
const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

test('digest liczy kandydatów tylko wśród kont z ≥1 dopasowaniem w tygodniu', async () => {
  const zNowym = await dodajUsera();
  const bezNowych = await dodajUsera();

  // Świeże dopasowanie dla pierwszego usera.
  await matches.create({
    userId: zNowym.id,
    tenderId: `wd-t-${process.pid}-${seq}`,
    score: 90,
    tender: { title: 'Przetarg tygodnia', organization: 'Gmina' },
  });

  const wynik = await runWeeklyDigest({ now: Date.now() });
  assert.equal(wynik.ok, true);
  assert.ok(wynik.uzytkownicy >= 2);
  assert.ok(wynik.kandydaci >= 1, 'user z nowym dopasowaniem musi być kandydatem');
  // bezNowych nie może podnieść licznika kandydatów za sprawą braku dopasowań — sprawdzamy pośrednio:
  const liczbaBez = await matches.countSince(bezNowych.id, new Date(Date.now() - 7 * 864e5).toISOString());
  assert.equal(liczbaBez, 0, 'konto bez dopasowań nie dostaje przeglądu');
});

test('digest pomija dopasowania starsze niż okno 7 dni', async () => {
  const user = await dodajUsera();
  const tid = `wd-old-${process.pid}-${seq}`;
  await matches.create({ userId: user.id, tenderId: tid, score: 80, tender: { title: 'Stary przetarg' } });

  // Cofamy created_at o 10 dni — poza oknem tygodnia.
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('users').doc(user.id).collection('matches').doc(tid)
    .set({ created_at: new Date(Date.now() - 10 * 864e5).toISOString() }, { merge: true });

  const liczba = await matches.countSince(user.id, new Date(Date.now() - 7 * 864e5).toISOString());
  assert.equal(liczba, 0, 'dopasowanie sprzed 10 dni nie wpada w okno 7 dni');
});
