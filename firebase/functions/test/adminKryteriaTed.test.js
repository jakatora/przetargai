import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * POST /admin/kryteria-ted-wstecz (2026-11-01): zakres dób w JEDNYM wywołaniu (limiter admina to
 * 20 wywołań na 15 min, a doba TED trwa ~6 s), uzupełnia tylko przetargi bez listy, nie tworzy nowych.
 * TED API podmienione — prawdziwe ogłoszenie z fixture.
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.ADMIN_API_KEY = 'testowy-klucz-administratora';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const F = JSON.parse(readFileSync(new URL('./fixtures/ted-kryteria.json', import.meta.url), 'utf8'));
const ZNAK = `${process.pid}${Date.now()}`.slice(-8);

test('zakres dób: jedno wywołanie, uzupełnia istniejący przetarg TED, obcego nie tworzy; zły zakres → 400', async () => {
  const numer = `9${ZNAK}-2026`;
  const obcy = `8${ZNAK}-2026`;
  const { tender } = await tenders.upsert({ externalId: `ted:${numer}`, title: 'Ubezpieczenie floty', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'ted' });
  const zapytaniaTed = [];
  const prawdziwyFetch = globalThis.fetch;
  globalThis.fetch = async (url, opcje) => {
    if (!String(url).includes('/v3/notices/search')) return prawdziwyFetch(url, opcje);
    const { query } = JSON.parse(opcje.body);
    zapytaniaTed.push(query.match(/publication-date = (\d{8})/)?.[1]);
    const notices = query.includes('20261027')
      ? [{ ...F.wieleCzesci, 'publication-number': numer, 'title-proc': { pol: 'Ubezpieczenie floty' } }, { ...F.punkty, 'publication-number': obcy, 'title-proc': { pol: 'Dostawa' } }]
      : [];
    return new Response(JSON.stringify({ notices, totalNoticeCount: notices.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const wolaj = (body) => prawdziwyFetch(`http://127.0.0.1:${port}/admin/kryteria-ted-wstecz`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': 'testowy-klucz-administratora' }, body: JSON.stringify(body),
    });
    const odp = await wolaj({ od: '2026-10-28', do: '2026-10-26' });
    assert.equal(odp.status, 200);
    const w = await odp.json();
    assert.deepEqual(zapytaniaTed, ['20261028', '20261027', '20261026'], 'od nowszej, wszystkie doby w jednym wywołaniu');
    assert.deepEqual([w.pobrane, w.istniejace, w.uzupelnione, w.do, w.dni.length], [2, 1, 1, '2026-10-26', 3]);
    const po = await tenders.findById(tender.id);
    assert.deepEqual([po.kryterium_oceny, po.kryteria.map((k) => k.nazwa)], ['cena_i_jakosc', ['Cena', 'Warunki ubezpieczenia']]);
    assert.equal(await tenders.findById(tender.id.replace(numer, obcy)), null, 'przetargu, którego nie mamy, nie tworzy');
    assert.equal((await wolaj({ od: '2026-10-01', do: '2026-10-05' })).status, 400);
    assert.equal((await wolaj({})).status, 400);
  } finally {
    serwer.close();
    globalThis.fetch = prawdziwyFetch;
  }
});
