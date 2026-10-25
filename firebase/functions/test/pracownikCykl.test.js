import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders } = await import('../src/db/repos.js');
const { pracujDlaWszystkich, przeliczProfil } = await import('../src/services/pracownik.js');

let seq = 0;
const przetarg = async (title) => (await tenders.upsert({ externalId: `pc-${process.pid}-${++seq}`, title, deadline: '2099-01-01T00:00:00.000Z' })).tender;
const konto = async (extra = {}) => {
  const u = await users.create({ email: `pc${process.pid}-${++seq}@t.pl`, passwordHash: 'h', keywords: ['dach'], ...extra });
  return users.findById(u.id);
};

test('tylkoStandard: płatny i w próbie tak, Free nie; powiadomienie po każdym obsłużonym', async () => {
  const free = await konto();
  const proba = await konto({ probaDni: 7 });
  const platny = await konto();
  await users.setTier(platny.id, 'standard');
  const pula = [await przetarg('Remont dachu Z')];
  const powiadomieni = [];
  const w = await pracujDlaWszystkich({
    tylkoStandard: true, tryb: 'co3h',
    wczytajUzytkownikow: async () => [free, proba, await users.findById(platny.id)],
    wczytajPule: async () => pula,
    powiadom: async (u, { tryb }) => { powiadomieni.push([u.id, tryb]); return 'ok'; },
  });
  assert.equal(w.obsluzeni, 2);
  assert.deepEqual(powiadomieni.map(([id]) => id).sort(), [proba.id, platny.id].sort());
  assert.ok(powiadomieni.every(([, tryb]) => tryb === 'co3h'));
});

test('bez kont Standard przebieg co 3 h nie czyta puli', async () => {
  let czytano = false;
  const w = await pracujDlaWszystkich({ tylkoStandard: true, wczytajUzytkownikow: async () => [await konto()],
    wczytajPule: async () => { czytano = true; return []; }, powiadom: async () => 'ok' });
  assert.equal(czytano, false);
  assert.equal(w.obsluzeni, 0);
});

test('awaria u jednego klienta nie zatrzymuje pozostałych', async () => {
  const zepsuty = { id: 'nie-istnieje', keywords: ['dach'], premium_tier: 'free' };
  const ok = await konto();
  const w = await pracujDlaWszystkich({ wczytajUzytkownikow: async () => [zepsuty, ok],
    wczytajPule: async () => [await przetarg('Remont dachu Y')], powiadom: async () => 'ok' });
  assert.equal(w.obsluzeni, 2);
});

test('przeliczProfil: hamulec 10 minut, wymus go pomija', async () => {
  const u = await konto();
  const a = await przeliczProfil(u);
  assert.equal(a.pominiety, undefined);
  assert.equal((await przeliczProfil(u)).pominiety, true);
  assert.equal((await przeliczProfil(u, { wymus: true })).pominiety, undefined);
});
