import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users } = await import('../src/db/repos.js');
const { rodzajMailaProby, wyslijMaileProby } = await import('../src/services/mailProby.js');

const KONIEC = '2026-10-27T10:00:00.000Z';
const u = (extra = {}) => ({ id: 'x', email: 'a@b.pl', premium_tier: 'free', proba_do: KONIEC, ...extra });

test('rodzajMailaProby: przypomnienie ≤48 h przed końcem, koniec po końcu (do 7 dni), nic dla płacących i bez próby', () => {
  assert.equal(rodzajMailaProby(u(), '2026-10-24T10:00:00.000Z'), null);
  assert.equal(rodzajMailaProby(u(), '2026-10-25T10:00:00.000Z'), 'przypomnienie');
  assert.equal(rodzajMailaProby(u({ proba_maile: { przypomnienie: { stan: 'wyslany' } } }), '2026-10-26T10:00:00.000Z'), null);
  assert.equal(rodzajMailaProby(u(), KONIEC), 'koniec');
  assert.equal(rodzajMailaProby(u(), '2026-11-10T10:00:00.000Z'), null);
  assert.equal(rodzajMailaProby(u({ premium_tier: 'standard' }), KONIEC), null);
  assert.equal(rodzajMailaProby(u({ proba_do: null }), KONIEC), null);
});

test('REVIEW FOCUS 5: mail końca próby dokładnie raz (dwa przebiegi)', async () => {
  const konto = await users.create({ email: `mp${process.pid}@t.pl`, passwordHash: 'h', probaDni: 7 });
  const wyslane = [];
  const wyslijEmail = async (m) => { wyslane.push(m); return { sent: true }; };
  const poKoncu = new Date(Date.parse(konto.proba_do) + 3_600_000).toISOString();
  const wczytaj = async () => [await users.findById(konto.id)];
  assert.equal((await wyslijMaileProby({ teraz: poKoncu, wyslijEmail, wczytajUzytkownikow: wczytaj })).wyslane, 1);
  assert.equal((await wyslijMaileProby({ teraz: poKoncu, wyslijEmail, wczytajUzytkownikow: wczytaj })).wyslane, 0);
  assert.equal(wyslane.length, 1);
  assert.match(wyslane[0].subject, /Próba Standard się skończyła/);
});

test('nieudana wysyłka zwalnia znacznik — następny przebieg ponawia', async () => {
  const konto = await users.create({ email: `mp2${process.pid}@t.pl`, passwordHash: 'h', probaDni: 7 });
  const poKoncu = new Date(Date.parse(konto.proba_do) + 3_600_000).toISOString();
  const wczytaj = async () => [await users.findById(konto.id)];
  const w1 = await wyslijMaileProby({ teraz: poKoncu, wyslijEmail: async () => ({ sent: false, error: 'x' }), wczytajUzytkownikow: wczytaj });
  assert.equal(w1.bledy, 1);
  const w2 = await wyslijMaileProby({ teraz: poKoncu, wyslijEmail: async () => ({ sent: true }), wczytajUzytkownikow: wczytaj });
  assert.equal(w2.wyslane, 1);
});
