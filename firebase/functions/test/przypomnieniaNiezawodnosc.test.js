import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Przypomnienia o terminach — idempotencja i niezawodność (2026-09-25).
 *
 * P2: dwa równoległe przebiegi joba (podwójne wyzwolenie Cloud Schedulera albo
 *     ponowienie) wysyłały ten sam push dwa razy — etap nie był rezerwowany.
 * P1: etap przesuwał się bez względu na wynik wysyłki (`sendPush` NIE rzuca, zwraca
 *     `{sent, failed}`), więc awaria Expo po cichu kasowała przypomnienie; job nie
 *     patrzył też na aktualny stan przetargu — przypominał o anulowanych i liczył
 *     etapy od terminu, który w źródle już się zmienił.
 *
 * Expo Push API przechwytujemy atrapą fetch sterowaną per token.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, matches, saved, tenders } = await import('../src/db/repos.js');
const { runReminderCheck, MAKS_PROB_WYSYLKI } = await import('../src/jobs/remindDeadlines.js');
const { getFirestore } = await import('firebase-admin/firestore');

const oryginalnyFetch = globalThis.fetch;
let pushe; // token → liczba prób dostarczenia
let tryby; // token → 'ok' | 'http500' | 'niezarejestrowany'
beforeEach(() => { pushe = new Map(); tryby = new Map(); });
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('exp.host')) throw new Error(`Nieoczekiwane wyjście do sieci w teście: ${url}`);
  const wiadomosci = JSON.parse(opts.body);
  const bilety = [];
  let http500 = false;
  for (const w of wiadomosci) {
    pushe.set(w.to, (pushe.get(w.to) ?? 0) + 1);
    const tryb = tryby.get(w.to) ?? 'ok';
    if (tryb === 'http500') http500 = true;
    bilety.push(tryb === 'niezarejestrowany'
      ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok' });
  }
  if (http500) return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, json: async () => ({ data: bilety }) };
};
after(() => { globalThis.fetch = oryginalnyFetch; });

let seq = 0;
async function uzytkownik() {
  seq++;
  const token = `ExponentPushToken[pn-${process.pid}-${seq}]`;
  const u = await users.create({ email: `pn-${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  await users.setPushToken(u.id, token);
  return { userId: u.id, token };
}

const ref = (userId, tenderId) => getFirestore().collection('users').doc(userId).collection('saved').doc(tenderId);
const wpis = async (userId, tenderId) => (await ref(userId, tenderId).get()).data();

/** Zapisany przetarg (z dokumentem w `tenders`) z przypomnieniem wymagalnym TERAZ. */
async function wymagalne(userId, deadline = '2099-01-03T10:00:00.000Z') {
  seq++;
  const externalId = `pn-${process.pid}-${seq}`;
  const { tender } = await tenders.upsert({ externalId, title: `Przetarg ${seq}`, deadline });
  const { match } = await matches.create({ userId, tenderId: tender.id, score: 80, reasoning: 'x', tender });
  await saved.add(userId, match);
  await saved.setReminder(userId, tender.id, true); // etap 7 dla terminu 2099
  await ref(userId, tender.id).update({ remind_at: '2000-01-01T00:00:00.000Z' });
  return { tenderId: tender.id, externalId };
}

// ---------------- P2: idempotencja ----------------

test('dwa RÓWNOLEGŁE przebiegi → jeden push (etap rezerwowany transakcyjnie przed wysyłką)', async () => {
  const { userId, token } = await uzytkownik();
  const { tenderId } = await wymagalne(userId);

  await Promise.all([runReminderCheck(), runReminderCheck()]);

  assert.equal(pushe.get(token), 1, 'podwójne wyzwolenie joba nie może wysłać drugiego pusha');
  const po = await wpis(userId, tenderId);
  assert.deepEqual(po.reminded_stages, [7]);
  assert.equal(po.remind_etap, 3);
});

test('dwa KOLEJNE przebiegi → jeden push', async () => {
  const { userId, token } = await uzytkownik();
  await wymagalne(userId);
  await runReminderCheck();
  await runReminderCheck();
  assert.equal(pushe.get(token), 1);
});

// ---------------- P1: wynik wysyłki ----------------

test('nieudany push NIE przesuwa etapu — próba wraca w kolejnym przebiegu', async () => {
  const { userId, token } = await uzytkownik();
  const { tenderId } = await wymagalne(userId);
  tryby.set(token, 'http500');

  const wynik = await runReminderCheck();
  assert.ok(wynik.nieudane >= 1);
  let po = await wpis(userId, tenderId);
  assert.equal(po.remind_etap, 7, 'etap zostaje — przypomnienie nie może przepaść przez awarię Expo');
  assert.deepEqual(po.reminded_stages, []);
  assert.equal(po.reminder_notified, false);
  assert.equal(po.remind_proby, 1, 'licznik prób rośnie');
  assert.ok(po.remind_at > new Date().toISOString(), 'kolejna próba z odstępem, nie w pętli w tym samym przebiegu');

  // Następny przebieg (odstęp minął), Expo już działa → push dochodzi, etap się przesuwa.
  tryby.set(token, 'ok');
  await ref(userId, tenderId).update({ remind_at: '2000-01-01T00:00:00.000Z' });
  await runReminderCheck();
  po = await wpis(userId, tenderId);
  assert.equal(pushe.get(token), 2, 'jedna nieudana próba + jedna udana');
  assert.deepEqual(po.reminded_stages, [7]);
  assert.equal(po.remind_etap, 3);
  assert.equal(po.remind_proby, 0, 'nowy etap zaczyna z czystym licznikiem');
});

test(`po ${3} nieudanych próbach etap się przesuwa (bez pętli w nieskończoność)`, async () => {
  assert.equal(MAKS_PROB_WYSYLKI, 3);
  const { userId, token } = await uzytkownik();
  const { tenderId } = await wymagalne(userId);
  tryby.set(token, 'http500');
  await ref(userId, tenderId).update({ remind_proby: MAKS_PROB_WYSYLKI - 1 });

  const wynik = await runReminderCheck();
  assert.ok(wynik.porzucone >= 1);
  const po = await wpis(userId, tenderId);
  assert.deepEqual(po.reminded_stages, [7], 'limit prób wyczerpany — etap zamknięty (z błędem w logu)');
  assert.equal(po.remind_etap, 3);
  assert.equal(po.remind_proby, 0);
});

test('martwy token (DeviceNotRegistered) — błąd trwały, etap przesunięty bez ponowień', async () => {
  const { userId, token } = await uzytkownik();
  const { tenderId } = await wymagalne(userId);
  tryby.set(token, 'niezarejestrowany');

  await runReminderCheck();
  const po = await wpis(userId, tenderId);
  assert.deepEqual(po.reminded_stages, [7], 'ponawianie na martwy token niczego nie dowiezie');
  assert.equal(pushe.get(token), 1);
});

// ---------------- P1: aktualny stan przetargu ----------------

test('przetarg ANULOWANY w źródle → brak pusha, przypomnienie zamknięte', async () => {
  const { userId, token } = await uzytkownik();
  const { tenderId, externalId } = await wymagalne(userId);
  await tenders.oznaczAnulowany(externalId, { powod: 'unieważnienie' });

  // `uzgodnijKopiePrzetargu` (2026-09-25) już przy zapisie źródła wyłącza przypomnienie
  // na kopii w „Zapisanych" — ten wpis by więc w ogóle nie wrócił jako wymagalny, a poniższa
  // kontrola w remindDeadlines nigdy by nie zadziałała. Cofamy kopię do stanu SPRZED tej
  // propagacji (jak wpis zapisany, zanim ta poprawka trafiła na produkcję), żeby przetestować
  // WŁASNĄ, reaktywną kontrolę joba — drugą linię obrony, nie tylko synchronizację przy zapisie.
  await ref(userId, tenderId).update({ reminder_enabled: true, remind_at: '2000-01-01T00:00:00.000Z' });

  const wynik = await runReminderCheck();
  assert.equal(pushe.get(token) ?? 0, 0, 'nie przypominamy o postępowaniu, którego już nie ma');
  assert.ok(wynik.anulowane >= 1);
  const due = (await saved.dueReminders()).filter((d) => d.userId === userId && d.tenderId === tenderId);
  assert.equal(due.length, 0, 'anulowane nie wraca jako wymagalne');
});

test('termin PRZESUNIĘTY w źródle → etap liczony od nowego terminu, brak przedwczesnego pusha', async () => {
  const { userId, token } = await uzytkownik();
  const { tenderId, externalId } = await wymagalne(userId, '2099-01-03T10:00:00.000Z');
  await tenders.zaktualizujZeZrodla({ externalId, deadline: '2099-03-03T10:00:00.000Z' });

  // Jak wyżej: cofamy kopię do stanu sprzed propagacji przy zapisie, żeby przetestować
  // reaktywną kontrolę w remindDeadlines (drugą linię obrony) niezależnie od niej.
  await ref(userId, tenderId).update({
    tender_deadline: '2099-01-03T10:00:00.000Z',
    remind_at: '2000-01-01T00:00:00.000Z',
    remind_etap: 7,
  });

  const wynik = await runReminderCheck();
  assert.equal(pushe.get(token) ?? 0, 0, '„zostało 7 dni" przy terminie za dwa miesiące to fałszywy alarm');
  assert.ok(wynik.przeplanowane >= 1);
  const po = await wpis(userId, tenderId);
  assert.equal(po.tender_deadline, '2099-03-03T10:00:00.000Z', 'wpis dostaje aktualny termin');
  assert.equal(po.remind_at, '2099-02-24T10:00:00.000Z', '7 dni przed NOWYM terminem');
  assert.equal(po.remind_etap, 7);
  assert.deepEqual(po.reminded_stages, []);
});

test('termin w źródle już MINĄŁ → brak pusha, przypomnienie zamknięte', async () => {
  const { userId, token } = await uzytkownik();
  const { tenderId, externalId } = await wymagalne(userId);
  await tenders.zaktualizujZeZrodla({ externalId, deadline: '2020-01-01T10:00:00.000Z' });

  await runReminderCheck();
  assert.equal(pushe.get(token) ?? 0, 0);
  assert.equal((await wpis(userId, tenderId)).reminder_notified, true);
});

test('bez dokumentu przetargu (stary wpis) job działa na danych wpisu', async () => {
  const { userId, token } = await uzytkownik();
  seq++;
  const tenderId = `pn-bez-${process.pid}-${seq}`;
  const { match } = await matches.create({
    userId, tenderId, score: 80, reasoning: 'x', tender: { title: 'Bez dokumentu', deadline: '2099-01-03T10:00:00.000Z' },
  });
  await saved.add(userId, match);
  await saved.setReminder(userId, tenderId, true);
  await ref(userId, tenderId).update({ remind_at: '2000-01-01T00:00:00.000Z' });

  await runReminderCheck();
  assert.equal(pushe.get(token), 1);
});
