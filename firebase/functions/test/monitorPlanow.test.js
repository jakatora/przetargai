import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Obserwacja planu → alert „przetarg z planu ogłoszono" (Radar planów).
 * Realny serwer HTTP + przebieg monitoringu na emulatorze; wysyłka wstrzykiwana.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, planyPostepowan, alerty } = await import('../src/db/repos.js');
const { runMonitorPlanow } = await import('../src/jobs/monitorPlanow.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `mp${process.pid}x${Date.now()}`;
let seq = 0;

async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `mp-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123' }),
  });
  const { token, user } = await odp.json();
  return { token, userId: user.id };
}
const naglowki = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

const dzis = new Date().toISOString().slice(0, 10);
const NIP = '7010073777';
const PLAN = {
  id: `${ZNAK}-PLAN`,
  zrodlo: 'ted',
  rodzaj: 'pin-rtl',
  skraca_termin: true,
  przedmiot: 'Termomodernizacja budynku szkoły',
  cpv: ['45321000'],
  zamawiajacy: 'Gmina Obserwowana',
  zamawiajacy_nip: NIP,
  region: '14',
  terminWszczecia: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10),
  opublikowano: dzis,
};
const PLAN_BEZ_NIP = { ...PLAN, id: `${ZNAK}-BEZNIP`, zamawiajacy_nip: null };
await planyPostepowan.zapiszWiele([PLAN, PLAN_BEZ_NIP]);

describe('obserwacja planu przez HTTP', () => {
  test('bez tokenu 401, nieistniejący plan 404', async () => {
    assert.equal((await fetch(`${BAZA}/radar-planow/${PLAN.id}/obserwuj`, { method: 'POST' })).status, 401);
    const { token } = await konto();
    assert.equal((await fetch(`${BAZA}/radar-planow/nie-ma/obserwuj`, { method: 'POST', headers: naglowki(token) })).status, 404);
  });

  test('włączenie 201, powtórka 200, lista i flaga w szczególe', async () => {
    const { token } = await konto();
    const pierwszy = await fetch(`${BAZA}/radar-planow/${PLAN.id}/obserwuj`, { method: 'POST', headers: naglowki(token) });
    assert.equal(pierwszy.status, 201);
    assert.equal((await pierwszy.json()).ostrzezenie, null);
    const drugi = await fetch(`${BAZA}/radar-planow/${PLAN.id}/obserwuj`, { method: 'POST', headers: naglowki(token) });
    assert.equal(drugi.status, 200);

    const lista = await (await fetch(`${BAZA}/radar-planow/obserwowane`, { headers: naglowki(token) })).json();
    assert.equal(lista.obserwowane.length, 1);
    assert.equal(lista.obserwowane[0].plan_id, PLAN.id);

    const szczegol = await (await fetch(`${BAZA}/radar-planow/${PLAN.id}`, { headers: naglowki(token) })).json();
    assert.equal(szczegol.obserwowany, true);

    assert.equal((await fetch(`${BAZA}/radar-planow/${PLAN.id}/obserwuj`, { method: 'DELETE', headers: naglowki(token) })).status, 200);
    assert.equal((await fetch(`${BAZA}/radar-planow/${PLAN.id}/obserwuj`, { method: 'DELETE', headers: naglowki(token) })).status, 404);
  });

  test('plan bez NIP-u: obserwacja działa, ale z uczciwym ostrzeżeniem', async () => {
    const { token } = await konto();
    const odp = await fetch(`${BAZA}/radar-planow/${PLAN_BEZ_NIP.id}/obserwuj`, { method: 'POST', headers: naglowki(token) });
    assert.equal(odp.status, 201);
    assert.equal((await odp.json()).ostrzezenie.kod, 'brak_nip');
  });
});

describe('przebieg monitoringu planów', () => {
  test('ogłoszenie tego zamawiającego → JEDEN alert i JEDNO powiadomienie, obserwacja zamknięta', async () => {
    const { token, userId } = await konto();
    await fetch(`${BAZA}/radar-planow/${PLAN.id}/obserwuj`, { method: 'POST', headers: naglowki(token) });

    // Nic jeszcze nie ogłoszono → brak alertu, obserwacja trwa.
    const pushe = [];
    const emaile = [];
    const wyslijPush = async (tok, tresc) => { pushe.push(tresc); };
    const wyslijEmail = async (m) => { emaile.push(m); };
    await runMonitorPlanow({ wyslijPush, wyslijEmail });
    assert.equal((await alerty.lista(userId)).length, 0);

    await tenders.upsert({
      externalId: `ted:${ZNAK}-OGL`,
      title: 'Termomodernizacja budynku szkoły podstawowej',
      organization: 'Gmina Obserwowana',
      cpvMain: '45321000',
      source: 'ted',
      deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      publishedAt: new Date(Date.now() + 35 * 86_400_000).toISOString(),
      zamawiajacy_nip: NIP,
    });

    const wynik = await runMonitorPlanow({ wyslijPush, wyslijEmail });
    assert.equal(wynik.ok, true);
    const mojeAlerty = await alerty.lista(userId);
    assert.equal(mojeAlerty.length, 1);
    assert.equal(mojeAlerty[0].typ, 'plan_ogloszony');
    assert.match(mojeAlerty[0].tytul.pl, /To jest to, na co czekałeś/);
    // Konto testowe nie ma tokenu push → e-mail do właściciela obserwacji.
    const doMnie = emaile.filter((m) => /Termomodernizacja/.test(m.subject));
    assert.equal(doMnie.length, 1);

    // Ponowny przebieg: obserwacja zamknięta → nic nowego.
    await runMonitorPlanow({ wyslijPush, wyslijEmail });
    assert.equal((await alerty.lista(userId)).length, 1);
    assert.equal(emaile.filter((m) => /Termomodernizacja/.test(m.subject)).length, 1);

    const lista = await (await fetch(`${BAZA}/radar-planow/obserwowane`, { headers: naglowki(token) })).json();
    assert.equal(lista.obserwowane[0].aktywna, false);
    assert.equal(lista.obserwowane[0].zakonczenie, 'ogloszono');
    assert.ok(lista.obserwowane[0].znalezione.tender_id);
  });
});

test('monitoring planów nie ma drogi do płatnego AI', () => {
  for (const plik of ['../src/jobs/monitorPlanow.js', '../src/lib/obserwacjePlanow.js']) {
    const kod = readFileSync(new URL(plik, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/services\/ai\.js|services\/matching\.js|anthropic/i.test(kod), plik);
  }
});
