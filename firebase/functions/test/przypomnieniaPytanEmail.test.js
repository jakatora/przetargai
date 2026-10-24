import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Przypomnienie o ostatniej dobie na pytania do SWZ E-MAILEM, gdy użytkownik nie ma
 * tokena push (2026-10-24). Termin pytań mija raz — bez maila byłby przegapiony.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, saved, tenders } = await import('../src/db/repos.js');
const { runPrzypomnieniaPytanSwz } = await import('../src/jobs/przypomnieniaPytanSwz.js');

const TERMIN_SKLADANIA = '2098-03-10T09:00:00.000Z';
const W_OKNIE = '2098-03-05T21:00:00.000Z';
let seq = 0;
let maile = [];
beforeEach(() => { maile = []; });
const skrzynka = (sent = true) => async (msg) => { maile.push(msg); return sent ? { sent: true, id: 'e1' } : { sent: false, error: 'resend down' }; };

async function uzytkownikBezTokenu() {
  seq += 1;
  const email = `pytania-mail-${process.pid}-${seq}@test.invalid`;
  const u = await users.create({ email, passwordHash: 'h', keywords: ['x'] });
  return { id: u.id, email };
}
async function zapisany(userId) {
  seq += 1;
  const { tender } = await tenders.upsert({ externalId: `2098/PYTM ${process.pid}${seq}/01`, source: 'bzp', title: `Przetarg pytania mail ${seq}`, deadline: TERMIN_SKLADANIA });
  await saved.add(userId, { tender_id: tender.id, tender_title: tender.title, tender_deadline: TERMIN_SKLADANIA, tender_source: 'bzp' });
  await saved.setReminder(userId, tender.id, true);
  return tender.id;
}
const push = async () => { throw new Error('push nie powinien być wołany bez tokena'); };

test('bez tokena push: mail z tytułem przetargu i terminem; ponowny przebieg nie duplikuje', async () => {
  const u = await uzytkownikBezTokenu();
  await zapisany(u.id);
  const w = await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij: push, wyslijEmail: skrzynka(true) });
  const moje = maile.filter((m) => m.to === u.email);
  assert.equal(moje.length, 1);
  assert.match(moje[0].subject, /Ostatnia doba na pytania do SWZ/);
  assert.match(moje[0].text, /Przetarg pytania mail/);
  assert.match(moje[0].text, /Radar SWZ/);
  assert.ok(w.emaile >= 1);
  await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T03:00:00.000Z', wyslij: push, wyslijEmail: skrzynka(true) });
  assert.equal(maile.filter((m) => m.to === u.email).length, 1);
});

test('awaria poczty: ponowienie w kolejnym przebiegu, nie sukces', async () => {
  const u = await uzytkownikBezTokenu();
  await zapisany(u.id);
  const w = await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij: push, wyslijEmail: skrzynka(false) });
  assert.ok(w.nieudane >= 1);
  const w2 = await runPrzypomnieniaPytanSwz({ teraz: '2098-03-06T03:00:00.000Z', wyslij: push, wyslijEmail: skrzynka(true) });
  assert.ok(w2.emaile >= 1, 'po awarii mail idzie w kolejnym przebiegu');
});

test('tryb degradacji (brak klucza Resend) = jak dotąd: bez_tokenu, bez pętli prób', async () => {
  const u = await uzytkownikBezTokenu();
  await zapisany(u.id);
  const w = await runPrzypomnieniaPytanSwz({ teraz: W_OKNIE, wyslij: push, wyslijEmail: async () => ({ sent: false, degraded: true }) });
  assert.ok(w.bezTokenu >= 1);
  assert.equal(w.nieudane, 0);
});
