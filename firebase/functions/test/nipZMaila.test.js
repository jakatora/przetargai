import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * „Podaj NIP” z linku w przeglądzie tygodniowym (2026-11-02): formularz bez logowania, jednorazowy link
 * zużywany dopiero po udanym zapisie, nazwa firmy z Białej listy tylko w puste pole. Biała lista — atrapa.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users } = await import('../src/db/repos.js');
const { linkNipu } = await import('../src/services/nipZMaila.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
const oryginalnyFetch = globalThis.fetch;
const zapytaniaMf = [];
globalThis.fetch = async (url, opcje) => {
  if (String(url).startsWith('https://wl-api.mf.gov.pl/')) {
    zapytaniaMf.push(String(url));
    return { ok: true, json: async () => ({ result: { subject: { name: 'DACHPOL SPÓŁKA Z O.O.', nip: '5260250995' } } }) };
  }
  return oryginalnyFetch(url, opcje);
};
after(() => { globalThis.fetch = oryginalnyFetch; serwer.close(); });

let seq = 0;
const konto = async (dane = {}) => (users.create({ email: `nipm${process.pid}-${++seq}-${Date.now()}@t.pl`, passwordHash: 'h', keywords: ['x'], ...dane }));
const sciezka = (link) => link.replace(/^.*\/maile\//, `${BAZA}/maile/`);
const wyslij = (url, nip) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `nip=${encodeURIComponent(nip)}` });

test('link z przeglądu: GET pokazuje formularz, zły NIP nie zużywa linku, dobry zapisuje NIP i nazwę firmy, drugi raz — wygasł', async () => {
  const u = await konto();
  const url = sciezka(await linkNipu(u.id));
  const formularz = await fetch(url);
  assert.equal(formularz.status, 200);
  assert.match(await formularz.text(), /name="nip"/);

  const zly = await wyslij(url, '123-456-78-90');
  assert.equal(zly.status, 400);
  assert.match(await zly.text(), /To nie jest prawidłowy NIP/);
  assert.equal((await users.findById(u.id)).company_nip ?? null, null);

  const ok = await wyslij(url, '526-025-09-95');
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /zapisaliśmy NIP 5260250995<\/b> \(DACHPOL SPÓŁKA Z O\.O\.\)/);
  const po = await users.findById(u.id);
  assert.deepEqual([po.company_nip, po.company_name], ['5260250995', 'DACHPOL SPÓŁKA Z O.O.']);
  assert.equal(zapytaniaMf.length, 1);

  assert.equal((await wyslij(url, '5260250995')).status, 400, 'link jednorazowy');
  assert.equal((await fetch(url)).status, 400);
});

test('NIP innego konta → 409 i link zostaje; nazwa wpisana przez klienta nie jest nadpisywana', async () => {
  const zajety = await konto();
  await users.ustawNip(zajety.id, '7740001454');
  const u = await konto({ companyName: 'Moja Firma' });
  const url = sciezka(await linkNipu(u.id));
  const odp = await wyslij(url, '7740001454');
  assert.equal(odp.status, 409);
  assert.equal((await fetch(url)).status, 200, 'link wciąż ważny');
  assert.equal((await wyslij(url, '5213017228')).status, 200);
  const po = await users.findById(u.id);
  assert.equal(po.company_nip, '5213017228');
  assert.equal(po.company_name, 'Moja Firma');
});

test('bez tokenu albo z cudzym celem — 400, nic się nie zapisuje', async () => {
  assert.equal((await fetch(`${BAZA}/maile/nip`)).status, 400);
  assert.equal((await wyslij(`${BAZA}/maile/nip?token=nieistnieje`, '5260250995')).status, 400);
});
