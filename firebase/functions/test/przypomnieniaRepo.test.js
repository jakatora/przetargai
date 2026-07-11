import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Przypomnienia o terminie na warstwie danych + trasa PUT /matches/:id/reminder.
 * Biegnie na emulatorze.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, matches, saved } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function uzytkownikZTokenem() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `rem-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['x'] }),
  });
  const { token, user } = await odp.json();
  return { token, userId: user.id };
}

// Tworzy dopasowanie z zadanym terminem prosto w bazie i zapisuje je do zakładek.
async function zapiszZTerminem(userId, deadline) {
  seq++;
  const tenderId = `rem-t-${process.pid}-${seq}`;
  const { match } = await matches.create({
    userId, tenderId, score: 80, reasoning: 'x',
    tender: { title: 'Przetarg z terminem', deadline },
  });
  await saved.add(userId, match);
  return tenderId;
}

test('setReminder liczy remind_at z terminu i zapisuje w wpisie', async () => {
  const { userId } = await uzytkownikZTokenem();
  const t = await zapiszZTerminem(userId, '2099-01-03T10:00:00.000Z');

  const wynik = await saved.setReminder(userId, t, true);
  assert.equal(wynik.reminder_enabled, true);
  assert.equal(wynik.remind_at, '2099-01-01T10:00:00.000Z', '48 h przed terminem');

  const lista = await saved.list(userId);
  const wpis = lista.find((s) => s.id === t);
  assert.equal(wpis.reminder_enabled, true);
  assert.equal(wpis.reminder_notified, false);
});

test('setReminder(false) wyłącza przypomnienie', async () => {
  const { userId } = await uzytkownikZTokenem();
  const t = await zapiszZTerminem(userId, '2099-01-03T10:00:00.000Z');
  await saved.setReminder(userId, t, true);
  const wynik = await saved.setReminder(userId, t, false);
  assert.equal(wynik.reminder_enabled, false);
});

test('przetarg bez terminu: przypomnienia NIE da się włączyć', async () => {
  const { userId } = await uzytkownikZTokenem();
  const t = await zapiszZTerminem(userId, null);
  const wynik = await saved.setReminder(userId, t, true);
  assert.equal(wynik.reminder_enabled, false, 'bez terminu nie ma czego przypominać');
  assert.equal(wynik.powod, 'brak_terminu');
});

test('dueReminders zwraca wpisy wymagalne (remind_at ≤ teraz, niepowiadomione) z userId', async () => {
  const { userId } = await uzytkownikZTokenem();
  const wymagalny = await zapiszZTerminem(userId, '2099-01-03T10:00:00.000Z');
  const przyszly = await zapiszZTerminem(userId, '2099-06-01T10:00:00.000Z');
  await saved.setReminder(userId, wymagalny, true);
  await saved.setReminder(userId, przyszly, true);

  const due = await saved.dueReminders('2099-01-02T00:00:00.000Z'); // po remind_at pierwszego
  const moje = due.filter((d) => d.userId === userId);
  assert.deepEqual(moje.map((d) => d.tenderId), [wymagalny], 'tylko pierwszy jest wymagalny');
  assert.equal(moje[0].userId, userId, 'niesie właściciela do wysyłki push');
});

test('markReminded wyklucza wpis z kolejnych dueReminders', async () => {
  const { userId } = await uzytkownikZTokenem();
  const t = await zapiszZTerminem(userId, '2099-01-03T10:00:00.000Z');
  await saved.setReminder(userId, t, true);

  await saved.markReminded(userId, t);
  const due = await saved.dueReminders('2099-01-02T00:00:00.000Z');
  assert.equal(due.filter((d) => d.tenderId === t).length, 0, 'powiadomiony nie wraca');
});

// ---------------- trasa ----------------

test('PUT /matches/:id/reminder włącza i zwraca stan; bez tokenu 401', async () => {
  const { token, userId } = await uzytkownikZTokenem();
  const t = await zapiszZTerminem(userId, '2099-01-03T10:00:00.000Z');

  const odp = await fetch(`${BAZA}/matches/${t}/reminder`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(odp.status, 200);
  const dane = await odp.json();
  assert.equal(dane.reminder_enabled, true);

  const bezTokenu = await fetch(`${BAZA}/matches/${t}/reminder`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(bezTokenu.status, 401);
});

test('PUT reminder dla nie-zapisanego przetargu → 404', async () => {
  const { token } = await uzytkownikZTokenem();
  const odp = await fetch(`${BAZA}/matches/nie-ma-takiego/reminder`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(odp.status, 404);
});
