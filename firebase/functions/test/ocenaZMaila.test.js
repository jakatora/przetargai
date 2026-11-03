import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * „Nie dla nas” z maila (2026-11-03): GET pokazuje przetarg i przyczyny bez zmian, POST odrzuca jak „Odrzuć” w apce
 * (dopasowanie schodzi z listy, sygnał z przyczyną dla selekcji); link wielokrotny i tylko do dopasowań tego konta.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches } = await import('../src/db/repos.js');
const { linkOceny, linkDoPozycji } = await import('../src/services/ocenaZMaila.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
after(() => serwer.close());

let seq = 0;
const ZNAK = `${process.pid}x${Date.now()}`;
async function kontoZWybranym(n = 1) {
  const u = await users.create({ email: `ozm${ZNAK}-${++seq}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const { tender } = await tenders.upsert({ externalId: `ozm-${ZNAK}-${++seq}`, title: `Remont dachu nr ${seq}`, organization: 'Gmina Rymanów', deadline: '2099-01-01T00:00:00.000Z', wojewodztwo: 'podkarpackie' });
    await matches.utworzWybrany({ userId: u.id, tender, score: 80, punkty: ['Dachy'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
    ids.push(tender.id);
  }
  return { user: await users.findById(u.id), ids };
}
const url = (link) => link.replace(/^.*\/maile\//, `${BAZA}/maile/`);
const post = (adres, cialo) => fetch(adres, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: cialo });

test('GET pokazuje przetarg i przyczyny, nic nie zmienia; POST odrzuca z sygnałem; ten sam link działa dla drugiej pozycji', async () => {
  const { user, ids } = await kontoZWybranym(2);
  const baza = await linkOceny(user.id);
  const adres = url(linkDoPozycji(baza, ids[0]));
  const strona = await fetch(adres);
  assert.equal(strona.status, 200);
  const html = await strona.text();
  assert.match(html, /Remont dachu nr/);
  assert.match(html, /Nie Twoja branża<\/button>/);
  assert.match(html, /Poza Twoim terenem<\/button>/);
  assert.equal((await matches.detail(user.id, ids[0])).odrzucony_przez_klienta ?? null, null, 'GET niczego nie odrzuca');

  const ok = await post(adres, 'przyczyna=za_duze');
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /zszedł z Twojej listy<\/b> \(za duże dla twojej firmy\)/);
  assert.equal((await matches.detail(user.id, ids[0])).odrzucony_przez_klienta.przyczyna, 'za_duze');
  const sygnaly = (await users.findById(user.id)).pracownik_sygnaly;
  assert.deepEqual(sygnaly.map((s) => [s.typ, s.przyczyna, s.tender_id]), [['odrzucenie', 'za_duze', ids[0]]]);

  assert.equal((await post(url(linkDoPozycji(baza, ids[1])), 'przyczyna=branza')).status, 200, 'link wielokrotny');
  assert.equal((await matches.detail(user.id, ids[1])).odrzucony_przez_klienta.przyczyna, 'branza');
  assert.equal((await post(adres, 'przyczyna=branza')).status, 200, 'ponowne odrzucenie — bez drugiego sygnału');
  assert.equal((await users.findById(user.id)).pracownik_sygnaly.length, 2);
});

test('„Poza terenem” u konta bez województw → link do wyboru terenu; obce dopasowanie i zła przyczyna → 400', async () => {
  const { user, ids } = await kontoZWybranym(2);
  const inny = await kontoZWybranym(1);
  const baza = await linkOceny(user.id);
  const odp = await post(url(linkDoPozycji(baza, ids[0])), 'przyczyna=teren');
  assert.match(await odp.text(), /<a href="[^"]*\/maile\/teren\?token=[^"]+"><b>Zaznacz swoje województwa<\/b><\/a>/);
  assert.equal((await post(url(linkDoPozycji(baza, inny.ids[0])), 'przyczyna=branza')).status, 400, 'cudze dopasowanie');
  assert.equal((await matches.detail(inny.user.id, inny.ids[0])).odrzucony_przez_klienta ?? null, null);
  assert.equal((await post(url(linkDoPozycji(baza, ids[1])), 'przyczyna=xyz')).status, 400, 'przyczyna spoza listy');
  assert.equal((await matches.detail(user.id, ids[1])).odrzucony_przez_klienta ?? null, null);
  assert.equal((await fetch(`${BAZA}/maile/ocena?token=nieistnieje&m=${ids[0]}`)).status, 400);
});
