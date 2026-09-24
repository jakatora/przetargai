import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Eksport CSV (P2-3) przez realny serwer HTTP na emulatorze.
 * RESEND_API_KEY pusty → e-mail w trybie degradacji (nic nie wychodzi na zewnątrz).
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { saved, tenders } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { LIMIT_WYSYLEK_DZIENNIE } = await import('../src/routes/eksport.js');
const { BOM } = await import('../src/lib/eksportCsv.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `ek${process.pid}x${Date.now()}`;
let seq = 0;

async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ek-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123' }),
  });
  const { token, user } = await odp.json();
  return { token, userId: user.id };
}
const naglowki = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

describe('GET /eksport/*.csv', () => {
  test('bez tokenu 401', async () => {
    assert.equal((await fetch(`${BAZA}/eksport/zapisane.csv`)).status, 401);
  });

  test('zapisane: BOM, nagłówek po polsku, średnik, ochrona formuł', async () => {
    const { token, userId } = await konto();
    await saved.add(userId, {
      tender_id: `${ZNAK}-S1`,
      tender_title: '=HYPERLINK("http://zly";"kliknij")',
      tender_organization: 'Gmina Łódź',
      tender_deadline: '2026-10-05T08:00:00.000Z',
      tender_budget: 1250000.5,
      tender_source: 'bzp',
    });
    const odp = await fetch(`${BAZA}/eksport/zapisane.csv`, { headers: naglowki(token) });
    assert.equal(odp.status, 200);
    assert.match(odp.headers.get('content-type'), /text\/csv/);
    assert.match(odp.headers.get('content-disposition'), /przetargai-zapisane-\d{4}-\d{2}-\d{2}\.csv/);
    const bajty = Buffer.from(await odp.arrayBuffer());
    const tekst = bajty.toString('utf8');
    assert.ok(tekst.startsWith(BOM), 'BOM musi dojść do klienta');
    assert.match(tekst, /Przedmiot zamówienia;Zamawiający;Etap/);
    assert.match(tekst, /"'=HYPERLINK/);
    assert.match(tekst, /Gmina Łódź/);
    assert.match(tekst, /1250000,5/);
    assert.match(tekst, /2026-10-05 10:00/);
    assert.equal(odp.headers.get('x-wierszy'), '1');
  });

  test('katalog: filtry jak w GET /tenders', async () => {
    const { token } = await konto();
    await tenders.upsert({
      externalId: `${ZNAK}-K1`,
      title: `Eksportowalny przetarg ${ZNAK}`,
      organization: 'Szpital',
      cpvMain: '33100000',
      source: 'bzp',
      wojewodztwo: 'PL14',
      deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      publishedAt: new Date().toISOString(),
    });
    const odp = await fetch(`${BAZA}/eksport/katalog.csv?cpv=33100000`, { headers: naglowki(token) });
    assert.equal(odp.status, 200);
    const tekst = await odp.text();
    assert.match(tekst, new RegExp(`Eksportowalny przetarg ${ZNAK}`));
    assert.match(tekst, /Mazowieckie/);
  });
});

describe('POST /eksport/wyslij', () => {
  test('wysyła na adres z KONTA, nie z żądania', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/wyslij`, {
      method: 'POST', headers: naglowki(token),
      body: JSON.stringify({ rodzaj: 'zapisane', to: 'obcy@example.com' }),
    });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.match(dane.do, /@t\.pl$/);
    assert.equal(dane.tryb_degradacji, true, 'w testach bez RESEND nic nie wychodzi');
  });

  test('zły rodzaj → 400', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/eksport/wyslij`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ rodzaj: 'wszystko' }) });
    assert.equal(odp.status, 400);
  });

  test(`dzienny limit ${LIMIT_WYSYLEK_DZIENNIE} wysyłek → potem 429`, async () => {
    const { token } = await konto();
    for (let i = 0; i < LIMIT_WYSYLEK_DZIENNIE; i++) {
      const odp = await fetch(`${BAZA}/eksport/wyslij`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ rodzaj: 'zapisane' }) });
      assert.equal(odp.status, 200, `wysyłka ${i + 1}`);
    }
    const ponad = await fetch(`${BAZA}/eksport/wyslij`, { method: 'POST', headers: naglowki(token), body: JSON.stringify({ rodzaj: 'zapisane' }) });
    assert.equal(ponad.status, 429);
  });
});
