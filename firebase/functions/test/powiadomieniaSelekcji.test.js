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

test('konto bez terenu: mail pyta o województwa (link do /maile/teren) najwyżej raz na tydzień; z terenem — nie', async () => {
  const { user } = await kontoZWybranymi(1);
  const n = nadawcy();
  await powiadomPoPrzebiegu(user, { teraz: DZIEN, ...n });
  assert.match(n.wyslane.email[0].text, /Bierzesz zlecenia tylko w swojej okolicy\? Zaznacz województwa — resztę pominiemy: \S+\/maile\/teren\?token=/);
  assert.match(n.wyslane.email[0].html, /<b>Wybierz województwa<\/b><\/a>/);
  const po = await users.findById(user.id);
  assert.equal(po.teren_pytanie_o, DZIEN);

  const { tender } = await tenders.upsert({ externalId: `ps-${process.pid}-${++seq}`, title: 'Remont dachu jutro', deadline: '2099-01-01T00:00:00.000Z' });
  await matches.utworzWybrany({ userId: user.id, tender, score: 80, punkty: ['Dachy'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
  await powiadomPoPrzebiegu(po, { teraz: '2026-10-22T10:30:00.000Z', ...n });
  assert.equal(n.wyslane.email.length, 2);
  assert.doesNotMatch(n.wyslane.email[1].text, /maile\/teren/, 'dzień później — bez ponownego pytania');

  const z = await kontoZWybranymi(1);
  await users.ustawTeren(z.user.id, { regiony: ['18'] });
  const n2 = nadawcy();
  await powiadomPoPrzebiegu(await users.findById(z.user.id), { teraz: DZIEN, ...n2 });
  assert.doesNotMatch(n2.wyslane.email[0].text, /maile\/teren/);
});

test('Standard z działającym pushem: mail nie wychodzi, więc pytanie o teren nie jest zużyte', async () => {
  const { user } = await kontoZWybranymi(1, { tier: 'standard', push: 'ExponentPushToken[ps-teren]' });
  const n = nadawcy();
  assert.equal(await powiadomPoPrzebiegu(user, { tryb: 'co3h', teraz: DZIEN, ...n }), 'push');
  assert.equal(n.wyslane.email.length, 0);
  assert.equal((await users.findById(user.id)).teren_pytanie_o ?? null, null);
});

test('mail z wybranymi: przy każdej pozycji link „Nie dla nas” do /maile/ocena z id dopasowania', async () => {
  const { user, ids } = await kontoZWybranymi(2);
  const n = nadawcy();
  await powiadomPoPrzebiegu(user, { teraz: DZIEN, ...n });
  const linki = [...n.wyslane.email[0].text.matchAll(/Nie dla nas\? (\S+)/g)].map((x) => x[1]);
  assert.equal(linki.length, 2);
  assert.deepEqual(linki.map((l) => decodeURIComponent(l.split('&m=')[1])).sort(), [...ids].sort());
  assert.equal(new Set(linki.map((l) => l.split('&m=')[0])).size, 1, 'jeden token na mail');
});

test('Standard z pushem, wybrane z ≥ 3 województw, konto bez terenu: osobny mail „Gdzie pracujesz?” raz na tydzień', async () => {
  const u = await users.create({ email: `ps${process.pid}-${++seq}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  await users.setTier(u.id, 'standard');
  await users.setPushToken(u.id, 'ExponentPushToken[ps-teren-2]');
  for (const woj of ['podkarpackie', 'mazowieckie', 'pomorskie']) {
    const { tender } = await tenders.upsert({ externalId: `ps-${process.pid}-${++seq}`, title: `Remont dachu ${seq}`, deadline: '2099-01-01T00:00:00.000Z', wojewodztwo: woj });
    await matches.utworzWybrany({ userId: u.id, tender, score: 80, punkty: ['Dachy'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
  }
  const n = nadawcy();
  assert.equal(await powiadomPoPrzebiegu(await users.findById(u.id), { tryb: 'co3h', teraz: DZIEN, ...n }), 'push');
  assert.equal(n.wyslane.email.length, 1);
  assert.equal(n.wyslane.email[0].subject, 'Przetargi z całej Polski — zaznacz, gdzie pracujesz');
  assert.match(n.wyslane.email[0].text, /wybraliśmy dla Ciebie 3 przetargi z 3 województw[\s\S]*\/maile\/teren\?token=/);
  assert.equal((await users.findById(u.id)).teren_pytanie_o, DZIEN);

  const { tender } = await tenders.upsert({ externalId: `ps-${process.pid}-${++seq}`, title: 'Remont dachu kolejny', deadline: '2099-01-01T00:00:00.000Z', wojewodztwo: 'opolskie' });
  await matches.utworzWybrany({ userId: u.id, tender, score: 80, punkty: ['Dachy'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
  await powiadomPoPrzebiegu(await users.findById(u.id), { tryb: 'co3h', teraz: '2026-10-21T13:30:00.000Z', ...n });
  assert.equal(n.wyslane.email.length, 1, 'ten sam tydzień — bez drugiego maila');
});

test('Free: błąd przy budowie maila zwalnia rezerwację doby — kolejny przebieg wysyła', async () => {
  const { user } = await kontoZWybranymi(1);
  const n = nadawcy();
  await assert.rejects(powiadomPoPrzebiegu(user, { teraz: DZIEN, ...n, wyslijEmail: async () => { throw new Error('Firestore niedostępny'); } }));
  assert.equal(await powiadomPoPrzebiegu(user, { teraz: DZIEN, ...n }), 'dostarczono');
  assert.equal(n.wyslane.email.length, 1);
});

test('powiadomienie pomija kopię z platformy, gdy konto ma wpis wiodący (scalenie w nocy)', async () => {
  const { user, ids } = await kontoZWybranymi(1);
  const { tender: kopia } = await tenders.upsert({ externalId: `pz:ps${process.pid}${++seq}`, title: 'Remont dachu kopia', deadline: '2099-01-01T00:00:00.000Z', source: 'platformazakupowa' });
  await matches.utworzWybrany({ userId: user.id, tender: kopia, score: 80, punkty: ['Dachy'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
  await getFirestore().doc(`users/${user.id}/matches/${kopia.id}`).update({ tender_zastapiony_przez: ids[0] });
  const lista = await matches.doPowiadomienia(user.id, '2000-01-01T00:00:00.000Z');
  assert.deepEqual(lista.map((m) => m.id), ids);
});
