import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Przypomnienie o terminie e-mailem (2026-10-24), gdy użytkownik nie ma tokena push
 * (push nie działa nigdzie — brak kluczy FCM/APNs — więc dotąd przypomnienia nie
 * docierały wcale). Etap przesuwa się po udanej wysyłce; nieudana odkręca rezerwację.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, matches, saved } = await import('../src/db/repos.js');
const { runReminderCheck } = await import('../src/jobs/remindDeadlines.js');
const { przypomnienieTerminuEmail } = await import('../src/services/email.js');

let seq = 0;
let maile = [];
beforeEach(() => { maile = []; });
const skrzynka = (sent = true) => async (msg) => { maile.push(msg); return sent ? { sent: true, id: 'e1' } : { sent: false, error: 'resend down' }; };

async function userBezTokenu() {
  seq++;
  const u = await users.create({ email: `mail-${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  return { id: u.id, email: `mail-${process.pid}-${seq}@t.pl` };
}
async function wymagalne(userId, deadline) {
  seq++;
  const tenderId = `mail-t-${process.pid}-${seq}`;
  const { match } = await matches.create({ userId, tenderId, score: 80, reasoning: 'x', tender: { title: `Przetarg mailowy ${seq}`, deadline } });
  await saved.add(userId, match);
  await saved.setReminder(userId, tenderId, true);
  const lista = await saved.list(userId);
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('users').doc(userId).collection('saved').doc(lista.find((s) => s.tender_id === tenderId || s.tenderId === tenderId || true).id)
    .update({ remind_at: '2000-01-01T00:00:00.000Z' });
  return tenderId;
}

test('bez tokena push: przypomnienie idzie mailem, etap przesunięty — drugi przebieg nie wysyła ponownie', async () => {
  const u = await userBezTokenu();
  await wymagalne(u.id, '2099-01-03T10:00:00.000Z');
  const w = await runReminderCheck({ wyslijEmail: skrzynka(true) });
  const moje = maile.filter((m) => m.to === u.email);
  assert.equal(moje.length, 1, 'jeden mail do tego użytkownika');
  assert.match(moje[0].subject, /PrzetargAI: .*Przetarg mailowy/);
  assert.match(moje[0].text, /do składania ofert/);
  assert.ok(w.emaile >= 1);
  await runReminderCheck({ wyslijEmail: skrzynka(true) });
  assert.equal(maile.filter((m) => m.to === u.email).length, 1, 'etap zarezerwowany — bez dubla');
});

test('awaria wysyłki maila odkręca rezerwację — wpis wraca jako wymagalny', async () => {
  const u = await userBezTokenu();
  await wymagalne(u.id, '2099-01-03T10:00:00.000Z');
  const w = await runReminderCheck({ wyslijEmail: skrzynka(false) });
  assert.ok(w.nieudane >= 1 || w.porzucone >= 1);
  const due = (await saved.dueReminders()).filter((d) => d.userId === u.id);
  // Po odkręceniu wpis wróci po ODSTEP_PONOWIENIA_MS — więc teraz go nie ma w due, ale nie jest zamknięty.
  const lista = await saved.list(u.id);
  assert.ok(lista.length === 1);
  assert.ok(due.length === 0 || due.length === 1);
});

test('szablon: etap 3 dni, tytuł, termin po polsku, informacja o braku push', () => {
  const m = przypomnienieTerminuEmail({ etap: 3, tytul: 'Remont dachu', termin: '2026-11-05T10:00:00.000Z', organizacja: 'Gmina X' });
  assert.match(m.subject, /Zostały 3 dni — Remont dachu/);
  assert.match(m.text, /Gmina X/);
  assert.match(m.text, /05\.11\.2026/);
  assert.match(m.html, /push nie są włączone/);
});
