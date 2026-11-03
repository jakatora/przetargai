import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * „Gdzie pracujesz?” z maila (2026-11-03): GET pokazuje województwa i niczego nie zmienia, POST zapisuje teren
 * i od razu chowa wybrane spoza niego; „Biorę z całej Polski” kończy pytanie; pusty wybór nie pali linku.
 */
process.env.ANTHROPIC_API_KEY = ''; // features.ai = false → heurystyka decyduje ostatecznie
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches } = await import('../src/db/repos.js');
const { linkTerenu, czasPytacOTeren, liczbaWojewodztw } = await import('../src/services/terenZMaila.js');
const { pracujDlaUzytkownika } = await import('../src/services/pracownik.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
after(() => serwer.close());

let seq = 0;
const unikalne = `tzm${process.pid}x${Date.now()}`;
async function konto() {
  const u = await users.create({ email: `${unikalne}-${++seq}@t.pl`, passwordHash: 'h', keywords: [`${unikalne}dach`] });
  return users.findById(u.id);
}
async function przetarg(wojewodztwo) {
  const { tender } = await tenders.upsert({ externalId: `${unikalne}-${++seq}`, title: `Remont ${unikalne}dach nr ${seq}`,
    organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', wojewodztwo });
  return tender;
}
const url = (link) => link.replace(/^.*\/maile\//, `${BAZA}/maile/`);
const post = (adres, cialo) => fetch(adres, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: cialo });

test('czasPytacOTeren: bez terenu raz na 7 dni; z terenem albo po „cała Polska” — nigdy', () => {
  const t = '2026-11-03T10:00:00.000Z';
  assert.equal(czasPytacOTeren({ regiony: [] }, t), true);
  assert.equal(czasPytacOTeren({ regiony: [], teren_pytanie_o: '2026-10-30T10:00:00.000Z' }, t), false, '4 dni temu');
  assert.equal(czasPytacOTeren({ regiony: [], teren_pytanie_o: '2026-10-27T10:00:00.000Z' }, t), true, '7 dni temu');
  assert.equal(czasPytacOTeren({ regiony: ['18'] }, t), false);
  assert.equal(czasPytacOTeren({ regiony: [], teren_cala_polska: true }, t), false);
  assert.equal(liczbaWojewodztw([{ tender_wojewodztwo: 'PL18' }, { tender_wojewodztwo: 'podkarpackie' }, { tender_wojewodztwo: '14' }, {}]), 2,
    'różne zapisy tego samego województwa liczą się raz');
});

test('GET pokazuje 16 województw i nic nie zmienia; POST zapisuje teren i chowa wybrane spoza niego', async () => {
  const u = await konto();
  const tu = await przetarg('podkarpackie');
  const daleko = await przetarg('zachodniopomorskie');
  assert.equal((await pracujDlaUzytkownika(u, [tu, daleko], { teraz: new Date().toISOString() })).wybrane, 2);

  const adres = url(await linkTerenu(u.id));
  const strona = await fetch(adres);
  assert.equal(strona.status, 200);
  const html = await strona.text();
  assert.equal((html.match(/type="checkbox" name="woj"/g) ?? []).length, 16);
  assert.match(html, /Zapisz województwa<\/button>/);
  assert.deepEqual((await users.findById(u.id)).regiony ?? [], [], 'GET niczego nie zmienia');

  const ok = await post(adres, 'woj=18&akcja=zapisz');
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /bierzemy przetargi z: Podkarpackie[\s\S]*zeszło 1 przetarg spoza tego terenu/);
  assert.deepEqual((await users.findById(u.id)).regiony, ['18']);
  assert.equal((await matches.detail(u.id, daleko.id)).odrzucony_przez_pracownika?.przyczyna, 'teren');
  assert.equal((await matches.detail(u.id, tu.id)).odrzucony_przez_pracownika ?? null, null);
  assert.equal((await post(adres, 'woj=18&akcja=zapisz')).status, 400, 'drugi raz — link zużyty');
});

test('pusty wybór nie pali linku; „Biorę z całej Polski” zapisuje zgodę i kończy pytanie', async () => {
  const u = await konto();
  const adres = url(await linkTerenu(u.id));
  const pusty = await post(adres, 'akcja=zapisz');
  assert.equal(pusty.status, 400);
  assert.match(await pusty.text(), /Zaznacz co najmniej jedno województwo/);
  assert.equal((await post(adres, 'woj=nieznane&akcja=zapisz')).status, 400, 'nierozpoznane województwo = pusty wybór');

  const cala = await post(adres, 'akcja=cala');
  assert.equal(cala.status, 200);
  assert.match(await cala.text(), /z całej Polski/);
  const po = await users.findById(u.id);
  assert.deepEqual([po.regiony ?? [], po.teren_cala_polska], [[], true]);
  assert.equal(czasPytacOTeren(po, new Date(Date.now() + 30 * 86_400_000).toISOString()), false);
  assert.equal((await fetch(`${BAZA}/maile/teren?token=nieistnieje`)).status, 400);
});
