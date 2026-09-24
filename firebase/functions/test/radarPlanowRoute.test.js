import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * GET /radar-planow — Radar planów przez realny serwer HTTP.
 *
 * Własności, których nie wolno złamać:
 *  1. odczyt DARMOWY — żadnej drogi do płatnego AI (ekran ma się otwierać bez limitu),
 *  2. pusty profil dostaje rynek planów i podpowiedź, nie pusty ekran,
 *  3. „to jest to, na co czekałeś" tylko dla ogłoszenia TEGO zamawiającego po planie.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, users, planyPostepowan } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `rp${process.pid}x${Date.now()}`;
let seq = 0;

async function konto(profil = null) {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `rp-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123' }),
  });
  const { token, user } = await odp.json();
  if (profil) await users.updateProfile(user.id, profil);
  return token;
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const dzis = new Date().toISOString().slice(0, 10);
const zaMiesiace = (n) => new Date(Date.now() + n * 30 * 86_400_000).toISOString().slice(0, 10);

const NIP = '5251575309';
const PLAN = {
  id: `${ZNAK}-PLAN`,
  zrodlo: 'ted',
  rodzaj: 'pin-rtl',
  rodzaj_opis: { pl: 'x', en: 'x' },
  skraca_termin: true,
  przedmiot: 'Przebudowa drogi powiatowej',
  opis: 'Zakres: nawierzchnia, chodniki.',
  cpv: ['45233140'],
  cpv_dzialy: ['45'],
  zamawiajacy: 'Powiat Testowy',
  zamawiajacy_nip: NIP,
  region: '14',
  terminWszczecia: zaMiesiace(2),
  wartosc: null,
  waluta: null,
  opublikowano: dzis,
  url: 'https://ted.europa.eu/pl/notice/-/detail/test',
};
const OBCY = { ...PLAN, id: `${ZNAK}-OBCY`, przedmiot: 'Odbiór odpadów', cpv: ['90511000'], region: '02', zamawiajacy_nip: null };

await planyPostepowan.zapiszWiele([PLAN, OBCY]);
await planyPostepowan.przebudujIndeks({ dzisiaj: dzis });
planyPostepowan._wyczyscPamiec();

describe('GET /radar-planow', () => {
  test('bez tokenu 401', async () => {
    assert.equal((await fetch(`${BAZA}/radar-planow`)).status, 401);
  });

  test('ranking pod profil: pasujący plan z wynikiem i powodami, obcy odcięty', async () => {
    const token = await konto({ cpvCodes: ['45233140'], keywords: ['droga'], regiony: ['14'] });
    const odp = await fetch(`${BAZA}/radar-planow`, { headers: auth(token) });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.equal(dane.tryb, 'dla_mnie');
    const ids = dane.pozycje.map((p) => p.id);
    assert.ok(ids.includes(PLAN.id));
    assert.ok(!ids.includes(OBCY.id));
    const p = dane.pozycje.find((x) => x.id === PLAN.id);
    assert.equal(p.poziom, 'MOCNE');
    assert.equal(p.skraca_termin, true);
    assert.equal(dane.zrodlo.kod, 'ted_planowanie');
  });

  test('pusty profil: wszystkie plany + podpowiedź', async () => {
    const token = await konto();
    const dane = await (await fetch(`${BAZA}/radar-planow`, { headers: auth(token) })).json();
    assert.equal(dane.tryb, 'wszystkie');
    assert.equal(dane.podpowiedz.kod, 'uzupelnij_profil');
    assert.ok(dane.pozycje.some((p) => p.id === OBCY.id));
  });

  test('tryb wszystkie z filtrem regionu', async () => {
    const token = await konto();
    const dane = await (await fetch(`${BAZA}/radar-planow?tryb=wszystkie&region=PL02`, { headers: auth(token) })).json();
    assert.ok(dane.pozycje.every((p) => p.region === '02'));
    assert.ok(dane.pozycje.some((p) => p.id === OBCY.id));
  });

  test('niepoprawny parametr → 400', async () => {
    const token = await konto();
    assert.equal((await fetch(`${BAZA}/radar-planow?tryb=cos`, { headers: auth(token) })).status, 400);
    assert.equal((await fetch(`${BAZA}/radar-planow?limit=0`, { headers: auth(token) })).status, 400);
  });
});

describe('GET /radar-planow/:id', () => {
  test('nieistniejąca pozycja → 404', async () => {
    const token = await konto();
    assert.equal((await fetch(`${BAZA}/radar-planow/nie-ma-takiego`, { headers: auth(token) })).status, 404);
  });

  test('plan przygotowań, zanim ogłoszenie się ukaże', async () => {
    const token = await konto({ cpvCodes: ['45233140'], keywords: [], regiony: ['14'] });
    const dane = await (await fetch(`${BAZA}/radar-planow/${PLAN.id}`, { headers: auth(token) })).json();
    assert.equal(dane.pozycja.id, PLAN.id);
    assert.equal(dane.pozycja.opis, PLAN.opis);
    assert.ok(dane.przygotowania.kamienieMilowe.length >= 3);
    assert.equal(dane.ogloszenie_sprawdzone, true);
    assert.equal(dane.ogloszenie, null);
    assert.ok(dane.ostrzezenia.some((o) => o.kod === 'skrocony_termin'));
  });

  test('ogłoszenie tego zamawiającego po planie → alarm „to jest to"', async () => {
    await tenders.upsert({
      externalId: `ted:${ZNAK}-OGL`,
      title: 'Przebudowa drogi powiatowej nr 1234',
      organization: 'Powiat Testowy',
      cpvMain: '45233140',
      source: 'ted',
      deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      publishedAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      zamawiajacy_nip: NIP,
    });
    const token = await konto({ cpvCodes: ['45233140'], keywords: [], regiony: ['14'] });
    const dane = await (await fetch(`${BAZA}/radar-planow/${PLAN.id}`, { headers: auth(token) })).json();
    assert.ok(dane.ogloszenie, 'nie znaleziono ogłoszenia zamawiającego');
    assert.equal(dane.ogloszenie.alarm, true);
    assert.match(dane.ogloszenie.komunikat, /To jest to/);
  });
});

test('trasa radaru nie ma drogi do płatnego AI', () => {
  for (const plik of ['../src/routes/radarPlanow.js', '../src/lib/widokRadaru.js']) {
    const kod = readFileSync(new URL(plik, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/services\/ai\.js|services\/matching\.js|anthropic/i.test(kod), plik);
  }
});
