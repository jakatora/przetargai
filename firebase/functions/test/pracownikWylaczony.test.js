import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
process.env.PRACOWNIK_ENABLED = 'false';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches } = await import('../src/db/repos.js');
const { przeliczProfil } = await import('../src/services/pracownik.js');

test('PRACOWNIK_ENABLED=false: przeliczenie idzie starym silnikiem (bez uzasadnienia w punktach)', async () => {
  const u = await users.create({ email: `pw${process.pid}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  await tenders.upsert({ externalId: `pw-${process.pid}`, title: 'Remont dachu W', deadline: '2099-01-01T00:00:00.000Z' });
  tenders.odswiezPule();
  await przeliczProfil(await users.findById(u.id), { wymus: true });
  const [m] = await matches.listForUser(u.id, 5);
  assert.ok(m, 'stary silnik utworzył dopasowanie');
  assert.equal(m.uzasadnienie, undefined);
});
