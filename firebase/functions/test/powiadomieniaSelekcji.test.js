import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches, alerty } = await import('../src/db/repos.js');
const { powiadomPoPrzebiegu } = await import('../src/services/powiadomieniaSelekcji.js');
const { getFirestore } = await import('firebase-admin/firestore');

const DZIEN = '2026-10-21T10:30:00.000Z'; // 12:30 czasu polskiego
const NOC = '2026-10-21T21:30:00.000Z';   // 23:30
let seq = 0;
async function kontoZWybranymi(n, { tier = 'free', push = null, mail = true } = {}) {
  const u = await users.create({ email: `ps${process.pid}-${++seq}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  if (tier === 'standard') await users.setTier(u.id, 'standard');
  if (push) await users.setPushToken(u.id, push);
  if (!mail) await users.ustawPowiadomieniaEmail(u.id, false);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const { tender } = await tenders.upsert({ externalId: `ps-${process.pid}-${++seq}`, title: `Remont dachu ${seq}`, deadline: '2099-01-01T00:00:00.000Z' });
    await matches.utworzWybrany({ userId: u.id, tender, score: 80, punkty: ['Dachy', 'Teren'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
    ids.push(tender.id);
  }
  return { user: await users.findById(u.id), ids };
}
function nadawcy() {
  const wyslane = { push: [], email: [] };
  return {
    wyslane,
    wyslijPush: async (token, tresc) => { wyslane.push.push(tresc); return { sent: 1 }; },
    wyslijEmail: async (m) => { wyslane.email.push(m); return { sent: true, id: 'e1' }; },
  };
}

test('cisza nocna: nic nie wychodzi', async () => {
  const { user } = await kontoZWybranymi(1);
  const n = nadawcy();
  assert.equal(await powiadomPoPrzebiegu(user, { teraz: NOC, ...n }), 'cisza');
  assert.equal(n.wyslane.email.length, 0);
});

test('Free poza przebiegiem dziennym: nic', async () => {
  const { user } = await kontoZWybranymi(1);
  assert.equal(await powiadomPoPrzebiegu(user, { tryb: 'co3h', teraz: DZIEN, ...nadawcy() }), 'poza_harmonogramem');
});

test('REVIEW FOCUS 3: Free — jeden mail na dobę; drugi przebieg nie wysyła drugi raz', async () => {
  const { user, ids } = await kontoZWybranymi(2, { push: 'ExponentPushToken[ps-1]' });
  const n = nadawcy();
  assert.equal(await powiadomPoPrzebiegu(user, { teraz: DZIEN, ...n }), 'dostarczono');
  assert.equal(n.wyslane.email.length, 1);
  assert.equal(n.wyslane.email[0].subject, 'Mamy dla Ciebie 2 nowe przetargi');
  // Adres wypisu jest widoczny w treści maila — bez słowa „pracownik” (spec §14).
  assert.match(n.wyslane.email[0].text, /\/maile\/wypisz\?token=/);
  assert.doesNotMatch(n.wyslane.email[0].text, /pracownik/i);
  assert.equal(n.wyslane.push.length, 1);
  assert.equal((await matches.detail(user.id, ids[0])).notified, 1);
  assert.equal(await powiadomPoPrzebiegu(user, { teraz: DZIEN, ...n }), 'brak');
  assert.equal(n.wyslane.email.length, 1);
});

test('Free bez pusha i z wyłączonymi mailami: nic nie oznaczamy jako doręczone', async () => {
  const { user, ids } = await kontoZWybranymi(1, { mail: false });
  assert.equal(await powiadomPoPrzebiegu(user, { teraz: DZIEN, ...nadawcy() }), 'nie_dostarczono');
  assert.equal((await matches.detail(user.id, ids[0])).notified, 0);
});

test('odrzucone przez klienta nie trafiają do powiadomienia', async () => {
  const { user, ids } = await kontoZWybranymi(2);
  await matches.oznaczOdrzuconyPrzezKlienta(user.id, ids[0], { przyczyna: 'teren' });
  const n = nadawcy();
  await powiadomPoPrzebiegu(user, { teraz: DZIEN, ...n });
  assert.equal(n.wyslane.email[0].subject, 'Mamy dla Ciebie 1 nowy przetarg');
});

test('Standard: od razu — Centrum alertów + push; drugi przebieg nic', async () => {
  const { user } = await kontoZWybranymi(1, { tier: 'standard', push: 'ExponentPushToken[ps-2]' });
  const n = nadawcy();
  assert.equal(await powiadomPoPrzebiegu(user, { tryb: 'co3h', teraz: DZIEN, ...n }), 'push');
  assert.equal(n.wyslane.push[0].data.type, 'new_matches');
  assert.equal((await alerty.lista(user.id)).length, 1);
  assert.equal(await powiadomPoPrzebiegu(user, { tryb: 'co3h', teraz: DZIEN, ...n }), 'brak');
  assert.equal(n.wyslane.push.length, 1);
});

test('Standard: push nie dotarł → mail z szablonu wybranych; temat z tytułem przy jednym przetargu', async () => {
  const { user } = await kontoZWybranymi(1, { tier: 'standard', push: 'ExponentPushToken[ps-3]' });
  const n = nadawcy();
  n.wyslijPush = async () => ({ sent: 0, bledy: { DeviceNotRegistered: 1 }, martweTokeny: [] });
  assert.equal(await powiadomPoPrzebiegu(user, { tryb: 'co3h', teraz: DZIEN, ...n }), 'email');
  assert.match(n.wyslane.email[0].subject, /^Nowy przetarg dla Twojej firmy: Remont dachu/);
});

test('REVIEW FOCUS 3: Standard po przerwanym przebiegu (wpis w Centrum już jest) — bez drugiego pusha', async () => {
  const { user, ids } = await kontoZWybranymi(1, { tier: 'standard', push: 'ExponentPushToken[ps-4]' });
  const n = nadawcy();
  await powiadomPoPrzebiegu(user, { tryb: 'co3h', teraz: DZIEN, ...n });
  // Symulacja: oznaczenie „notified” nie doszło do skutku przed przerwaniem przebiegu.
  await getFirestore().collection('users').doc(user.id).collection('matches').doc(ids[0]).update({ notified: 0 });
  assert.equal(await powiadomPoPrzebiegu(user, { tryb: 'co3h', teraz: DZIEN, ...n }), 'juz_wyslane');
  assert.equal(n.wyslane.push.length, 1);
});
