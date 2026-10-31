import { test } from 'node:test';
import assert from 'node:assert/strict';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { pdfZLiniami } = await import('./pdfTestowy.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const WAGI = [6, 5, 7, 2, 3, 4, 5, 6, 7];
function losowyNip() {
  for (;;) {
    const d = Array.from({ length: 9 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10)));
    const k = d.reduce((s, x, i) => s + x * WAGI[i], 0) % 11;
    if (k !== 10) return `${d.join('')}${k}`;
  }
}

test('POST /oferta/kontrola: raport z plików (podpis, NIP-y z zamawiającym przetargu); bez tokenu 401; złe wejście 400', async () => {
  const nip = losowyNip();
  const rej = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `of-${process.pid}-${Date.now()}@t.pl`, password: 'tajnehaslo123', company_nip: nip }),
  });
  assert.equal(rej.status, 201);
  const { token } = await rej.json();
  const nipZam = '7490005094';
  const { tender } = await tenders.upsert({ externalId: `of-${process.pid}-${Date.now()}`, title: 'Dostawa', organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp', zamawiajacy_nip: nipZam });
  const formularz = pdfZLiniami([`Wykonawca NIP ${nip}`, `Zamawiajacy NIP ${nipZam}`, 'Cena oferty brutto: 10 000,00 zl'], { podpis: true });
  const odp = await fetch(`${BAZA}/oferta/kontrola`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tender_id: tender.id, pliki: [{ nazwa: 'Formularz ofertowy.pdf', base64: formularz.toString('base64') }] }),
  });
  assert.equal(odp.status, 200);
  const r = await odp.json();
  assert.equal(r.tender_id, tender.id);
  assert.equal(r.podsumowanie.bledy, 0);
  const kody = r.wyniki.map((w) => w.kod);
  assert.ok(kody.includes('podpisy_ok') && kody.includes('nip_ok') && kody.includes('kwota'));
  assert.ok(!kody.includes('obcy_nip'), 'NIP zamawiającego przetargu nie jest „obcy”');

  assert.equal((await fetch(`${BAZA}/oferta/kontrola`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  const zle = await fetch(`${BAZA}/oferta/kontrola`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pliki: [] }) });
  assert.equal(zle.status, 400);
});
