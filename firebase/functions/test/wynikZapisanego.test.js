import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alertWynikuZapisanego } from '../src/lib/wynikZapisanego.js';
import { runWynikiZapisanych } from '../src/jobs/wynikiZapisanych.js';

/*
 * Wynik zapisanego przetargu (2026-11-01): złączenie ogłoszenia o wyniku BZP z Zapisanymi po
 * identyfikatorze postępowania i jedno zdanie do centrum alertów (+ push/e-mail).
 */
const czesc = (nadpisz = {}) => ({
  numer: 1, uniewaznione: false, cenaWybrana: 120000, cenaNajnizsza: 98000, cenaNajwyzsza: 160000, wartoscUmowy: 120000,
  liczbaOfert: 5, spojne: true, zwyciezca: { nazwa: 'BUDREM Sp. z o.o.', nip: '526-104-08-28' }, ...nadpisz,
});
const wynik = (czesci, nadpisz = {}) => ({ externalId: '2026/BZP 00512345', tenderId: 'ocds-148610-abc', tytul: 'Remont dachu', czesci, opublikowano: '2026-11-01', ...nadpisz });
const tender = { id: 'bzp_1', title: 'Remont dachu szkoły', organization: 'Gmina Przeworsk', deadline: '2026-09-10T08:00:00.000Z', source: 'bzp', postepowanie_id: 'ocds-148610-abc' };

test('jedna część: kto wygrał, za ile, ile ofert i rozrzut cen', () => {
  const a = alertWynikuZapisanego({ tenderId: 'bzp_1', tender, wynik: wynik([czesc()]) });
  assert.equal(a.typ, 'wynik_przetargu');
  assert.equal(a.klucz, 'wynik_bzp_1');
  assert.equal(a.ton, 'neutral');
  assert.equal(a.tytul.pl, 'Wynik przetargu: Remont dachu szkoły');
  assert.equal(a.tresc.pl, 'Wygrał BUDREM Sp. z o.o. za 120 000 zł (5 ofert: od 98 000 zł do 160 000 zł).');
  assert.equal(a.tresc.en, 'Won by BUDREM Sp. z o.o. for PLN 120,000 (5 bids: PLN 98,000 to PLN 160,000).');
  assert.deepEqual(a.pozycje[0], { tender_id: 'bzp_1', tytul: 'Remont dachu szkoły', organizacja: 'Gmina Przeworsk', deadline: tender.deadline, zrodlo: 'bzp' });
});

test('wygrał NIP konta: gratulacje i wartość umowy, ton sukces', () => {
  const a = alertWynikuZapisanego({ tenderId: 'bzp_1', tender, wynik: wynik([czesc()]), nipKonta: 'PL5261040828' });
  assert.equal(a.ton, 'sukces');
  assert.equal(a.tytul.pl, 'Wygrałeś przetarg: Remont dachu szkoły');
  assert.match(a.tresc.pl, /^Twoja firma wygrała — umowa na 120 000 zł\. Wygrał BUDREM/);
});

test('części: numer przy każdej, unieważniona osobno, reszta jako „i jeszcze N”', () => {
  const a = alertWynikuZapisanego({
    tenderId: 'bzp_1', tender,
    wynik: wynik([czesc(), czesc({ numer: 2, uniewaznione: true, zwyciezca: null }), czesc({ numer: 3 })]),
  });
  assert.equal(a.tresc.pl, 'Część 1: wygrał BUDREM Sp. z o.o. za 120 000 zł (5 ofert: od 98 000 zł do 160 000 zł). Część 2: unieważniona. I jeszcze 1 część w aplikacji.');
});

test('całość unieważniona: ostrzeżenie o możliwym ponownym ogłoszeniu; bez części → null', () => {
  const a = alertWynikuZapisanego({ tenderId: 'bzp_1', tender, wynik: wynik([czesc({ uniewaznione: true, zwyciezca: null })]) });
  assert.deepEqual([a.ton, a.tytul.pl, a.tresc.pl], ['ostrzezenie', 'Przetarg unieważniony: Remont dachu szkoły', 'Zamawiający unieważnił postępowanie — może ogłosić je ponownie.']);
  assert.equal(alertWynikuZapisanego({ tenderId: 'bzp_1', tender, wynik: wynik([]) }), null);
});

test('jedna oferta i sprzeczne kwoty: bez rozrzutu', () => {
  const a = alertWynikuZapisanego({ tenderId: 'bzp_1', tender, wynik: wynik([czesc({ liczbaOfert: 1 })]) });
  assert.equal(a.tresc.pl, 'Wygrał BUDREM Sp. z o.o. za 120 000 zł (1 oferta).');
  const b = alertWynikuZapisanego({ tenderId: 'bzp_1', tender, wynik: wynik([czesc({ spojne: false })]) });
  assert.equal(b.tresc.pl, 'Wygrał BUDREM Sp. z o.o. za 120 000 zł (5 ofert).');
});

test('job: złącza po postepowanie_id, wysyła raz, pomija stare wyniki i obce postępowania', async () => {
  const dodane = new Set();
  const push = [];
  const deps = {
    teraz: Date.parse('2026-11-01T10:00:00Z'),
    zapisane: { otwarteWszystkich: async () => [{ userId: 'u1', tenderId: 'bzp_1' }, { userId: 'u2', tenderId: 'bzp_2' }] },
    przetargi: { stanMonitoraDokumentow: async () => [tender, { ...tender, id: 'bzp_2', postepowanie_id: 'ocds-148610-inne' }] },
    konta: { findById: async (id) => ({ id, push_token: `tok-${id}`, company_nip: null }) },
    alertyRepo: { dodaj: async (uid, alert) => { const k = `${uid}/${alert.klucz}`; const nowy = !dodane.has(k); dodane.add(k); return { nowy }; } },
    wyslijPush: async (token, tresc) => { push.push([token, tresc.title]); return { sent: 1 }; },
    wyslijEmail: async () => { throw new Error('nie powinno'); },
  };
  const wyniki = [wynik([czesc()]), wynik([czesc()], { tenderId: 'ocds-148610-stary', opublikowano: '2026-08-01' })];
  const r1 = await runWynikiZapisanych(wyniki, deps);
  assert.deepEqual(r1, { wynikow: 1, zapisanych: 2, dopasowane: 1, alerty: 1, push: 1, email: 0, bledy: 0 });
  assert.deepEqual(push, [['tok-u1', 'Wynik przetargu: Remont dachu szkoły']]);
  const r2 = await runWynikiZapisanych(wyniki, deps);
  assert.equal(r2.alerty, 0);
  assert.equal(push.length, 1);
});

test('job: przetarg z analizą SWZ (powiązanie) dostaje wynik jak zapisany; ten sam wpis z obu źródeł raz', async () => {
  const dodane = [];
  const deps = {
    teraz: Date.parse('2026-11-01T10:00:00Z'),
    zapisane: {
      otwarteWszystkich: async () => [{ userId: 'u1', tenderId: 'bzp_1' }],
      zaangazowaneWszystkich: async () => [{ userId: 'u1', tenderId: 'bzp_1' }, { userId: 'u3', tenderId: 'bzp_1' }],
    },
    przetargi: { stanMonitoraDokumentow: async () => [tender] },
    konta: { findById: async (id) => ({ id, email: `${id}@t.pl` }) },
    alertyRepo: { dodaj: async (uid, alert) => { dodane.push(`${uid}/${alert.klucz}`); return { nowy: true }; } },
    wyslijPush: async () => ({ sent: 1 }), wyslijEmail: async () => {},
  };
  const r = await runWynikiZapisanych([wynik([czesc()])], deps);
  assert.deepEqual([r.zapisanych, r.alerty, r.email], [2, 2, 2]);
  assert.deepEqual(dodane, ['u1/wynik_bzp_1', 'u3/wynik_bzp_1']);
});
