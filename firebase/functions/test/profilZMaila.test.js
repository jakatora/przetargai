import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * „Dopisz do profilu” z maila (2026-11-02): GET pokazuje propozycję, POST stosuje ją jak „Przyjmij” w panelu,
 * link jednorazowy; po samodzielnej zmianie profilu propozycja jest nieaktualna i nic się nie zapisuje.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users } = await import('../src/db/repos.js');
const { linkProfilu } = await import('../src/services/profilZMaila.js');
const { wersjaKarty } = await import('../src/lib/kartaFirmy.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
after(() => serwer.close());

let seq = 0;
async function kontoZSugestia() {
  const u = await users.create({ email: `pzm${process.pid}-${++seq}-${Date.now()}@t.pl`, passwordHash: 'h', keywords: ['Remont posadzka żywica'] });
  const zapisany = await users.findById(u.id);
  await users.zapiszSugestieProfilu(u.id, { keywords: ['posadzka żywiczna'], cpv: ['45430000'], w_puli: 7,
    przyklady: ['Wykonanie posadzki żywicznej w hali'], dla_wersji: wersjaKarty(zapisany), o: new Date().toISOString() });
  return users.findById(u.id);
}
const url = (link) => link.replace(/^.*\/maile\//, `${BAZA}/maile/`);

test('GET pokazuje propozycję z przykładami, POST dopisuje słowa i kody, link jednorazowy', async () => {
  const u = await kontoZSugestia();
  const adres = url(await linkProfilu(u.id));
  const strona = await fetch(adres);
  assert.equal(strona.status, 200);
  const html = await strona.text();
  assert.match(html, /kod CPV: 45430000 \(Podłogi i okładziny ścian\)/);
  assert.match(html, /<li>Wykonanie posadzki żywicznej w hali<\/li>/);
  assert.match(html, /Dopisz do profilu<\/button>/);
  assert.deepEqual((await users.findById(u.id)).keywords, ['Remont posadzka żywica'], 'GET niczego nie zmienia');

  const ok = await fetch(adres, { method: 'POST' });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Gotowe — profil uzupełniony/);
  const po = await users.findById(u.id);
  assert.deepEqual([po.keywords, po.cpv_codes], [['Remont posadzka żywica', 'posadzka żywiczna'], ['45430000']]);
  assert.equal((await fetch(adres, { method: 'POST' })).status, 400, 'drugi raz — link zużyty');
});

test('profil zmieniony przez klienta → propozycja nieaktualna, nic się nie zapisuje', async () => {
  const u = await kontoZSugestia();
  const adres = url(await linkProfilu(u.id));
  await users.updateProfile(u.id, { companyName: null, keywords: ['posadzki'], cpvCodes: [], regiony: [], wartoscMax: null });
  const odp = await fetch(adres, { method: 'POST' });
  assert.equal(odp.status, 400);
  assert.match(await odp.text(), /nieaktualna/);
  assert.deepEqual((await users.findById(u.id)).keywords, ['posadzki']);
  assert.equal((await fetch(`${BAZA}/maile/profil?token=nieistnieje`)).status, 400);
});
