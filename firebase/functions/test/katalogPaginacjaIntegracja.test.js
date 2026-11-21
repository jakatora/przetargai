import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polaczZEmulatorem } from './emulator.js';
await polaczZEmulatorem();
const { createApp } = await import('../src/app.js');
const { zasiejRzadkiKatalog } = await import('./fixtures/katalogRzadki.js');
const { utworzKatalogPaginowany } = await import('../../../mobile/src/lib/katalogPaginacja.js');

test('normalny GET /tenders + kontroler ekranu: pełny identyczny zbiór w obu sortowaniach i po paginacji przez luki >1200', async () => {
  const znak = `rzadki${process.pid}`;
  const { ids } = await zasiejRzadkiKatalog(znak);
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const baza = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${baza}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${znak}@example.invalid`, password: 'IzolowanyTest123' }),
    });
    assert.equal(login.status, 201);
    const { token } = await login.json();
    const zbiory = [];
    for (const sort of ['najnowsze', 'termin']) {
      const odpowiedzi = [];
      const katalog = utworzKatalogPaginowany({ pobierzStrone: async (p) => {
        const response = await fetch(`${baza}/tenders?${new URLSearchParams(p)}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        assert.equal(response.status, 200, JSON.stringify(data));
        odpowiedzi.push(data);
        return data;
      } });
      katalog.ustawParametry({ q: znak, sort, termin: 'aktywne' });
      await katalog.wczytaj();
      assert.equal(katalog.stan().blad, null);
      assert.equal(katalog.stan().pozycje.length, 20);
      assert.equal(katalog.stan().wyczerpano, false);
      await katalog.dociagnij();
      assert.equal(katalog.stan().blad, null);
      assert.equal(katalog.stan().wyczerpano, true);
      assert.equal(katalog.stan().pozycje.length, 27);
      assert.deepEqual(new Set(katalog.stan().pozycje.map((t) => t.id)), new Set(ids));
      const dates = katalog.stan().pozycje.map((t) => sort === 'termin' ? t.deadline : t.fetched_at);
      assert.deepEqual(dates, [...dates].sort((a, b) => sort === 'termin' ? a.localeCompare(b) : b.localeCompare(a)));
      if (sort === 'najnowsze') {
        assert.equal(odpowiedzi[0].count, 0, 'fixture musi odtworzyć pustą pierwszą porcję');
        assert.equal(odpowiedzi[0].wyczerpano, false);
        assert.ok(odpowiedzi.slice(2).some((p) => p.count === 0 && !p.wyczerpano), 'pusta luka także między stronami');
      }
      zbiory.push(new Set(katalog.stan().pozycje.map((t) => t.id)));
    }
    assert.deepEqual(zbiory[0], zbiory[1]);
  } finally { await new Promise((r) => server.close(r)); }
});
