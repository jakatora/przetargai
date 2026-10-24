import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adresBialejListy,
  mapujPodmiotBialejListy,
  komunikatBialejListy,
  pobierzDanePoNip,
} from '../src/lib/danePoNip.js';

/*
 * „Wpisz NIP — resztę wstawimy": dane firmy z Białej listy podatników VAT (MF),
 * publiczne API bez klucza. Mapowanie i komunikaty są czyste; samo pobieranie
 * dostaje wstrzyknięty `fetchFn`, więc test nie dotyka sieci.
 */

const PKO = {
  result: {
    subject: {
      name: 'POWSZECHNA KASA OSZCZĘDNOŚCI BANK POLSKI SPÓŁKA AKCYJNA',
      nip: '5250007738',
      regon: '016298263',
      krs: '0000026438',
      statusVat: 'Czynny',
      workingAddress: null,
      residenceAddress: 'ŚWIĘTOKRZYSKA 36, 00-116 WARSZAWA',
      representatives: [{ firstName: 'Jan', lastName: 'Kowalski', companyName: null }],
    },
    requestId: 'abc',
  },
};

test('adres zapytania: NIP tylko cyframi, data dzienna w UTC', () => {
  assert.equal(
    adresBialejListy('525-000-77-38', '2026-10-23T09:12:00.000Z'),
    'https://wl-api.mf.gov.pl/api/search/nip/5250007738?date=2026-10-23',
  );
});

test('mapowanie podmiotu: nazwa, adres (siedziba przed adresem działalności), REGON, rejestr KRS, status VAT', () => {
  const d = mapujPodmiotBialejListy(PKO);
  assert.deepEqual(d, {
    nazwa: 'POWSZECHNA KASA OSZCZĘDNOŚCI BANK POLSKI SPÓŁKA AKCYJNA',
    nip: '5250007738',
    adres: 'ŚWIĘTOKRZYSKA 36, 00-116 WARSZAWA',
    regon: '016298263',
    rejestr: 'KRS 0000026438',
    statusVat: 'Czynny',
    reprezentanci: ['Jan Kowalski'],
  });
});

test('mapowanie JDG: brak KRS → rejestr CEIDG; adres działalności gdy brak siedziby; zwolniony z VAT nie blokuje', () => {
  const d = mapujPodmiotBialejListy({
    result: { subject: { name: 'ZAKŁAD STOLARSKI ANNA NOWAK', nip: '7340000007', regon: '123456789', krs: null, statusVat: 'Zwolniony', workingAddress: 'LIPOWA 2, 33-300 NOWY SĄCZ', residenceAddress: null, representatives: [] } },
  });
  assert.equal(d.rejestr, 'CEIDG');
  assert.equal(d.adres, 'LIPOWA 2, 33-300 NOWY SĄCZ');
  assert.equal(d.statusVat, 'Zwolniony');
  assert.deepEqual(d.reprezentanci, []);
});

test('mapowanie: brak podmiotu albo śmieci → null, nigdy nie rzuca', () => {
  assert.equal(mapujPodmiotBialejListy({ result: { subject: null } }), null);
  assert.equal(mapujPodmiotBialejListy(null), null);
  assert.equal(mapujPodmiotBialejListy('tekst'), null);
});

test('komunikaty: kody MF po polsku, nieznany kod → ogólny', () => {
  assert.match(komunikatBialejListy({ code: 'WL-115', message: 'Nieprawidłowy NIP.' }), /NIP/);
  assert.match(komunikatBialejListy({ code: 'WL-999' }), /Biała lista/);
  assert.match(komunikatBialejListy(null), /Biała lista/);
});

test('pobierzDanePoNip: 200 z podmiotem → dane; 200 bez podmiotu → błąd „nie znaleziono"', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => PKO });
  const ok = await pobierzDanePoNip('5250007738', { fetchFn, dzisiaj: '2026-10-23T00:00:00Z' });
  assert.equal(ok.dane.nazwa, PKO.result.subject.name);
  assert.equal(ok.blad, null);

  const pusty = async () => ({ ok: true, status: 200, json: async () => ({ result: { subject: null } }) });
  const brak = await pobierzDanePoNip('5250007738', { fetchFn: pusty, dzisiaj: '2026-10-23T00:00:00Z' });
  assert.equal(brak.dane, null);
  assert.match(brak.blad, /nie znalaz/i);
});

test('pobierzDanePoNip: błąd HTTP z kodem MF, zły NIP bez sieci, awaria sieci — zawsze {dane:null, blad}', async () => {
  const bledny = async () => ({ ok: false, status: 400, json: async () => ({ code: 'WL-115', message: 'Nieprawidłowy NIP.' }) });
  const r1 = await pobierzDanePoNip('5250007738', { fetchFn: bledny, dzisiaj: '2026-10-23T00:00:00Z' });
  assert.equal(r1.dane, null);
  assert.match(r1.blad, /NIP/);

  let wolano = false;
  const r2 = await pobierzDanePoNip('123', { fetchFn: async () => { wolano = true; }, dzisiaj: '2026-10-23T00:00:00Z' });
  assert.equal(wolano, false, 'niepoprawny NIP nie idzie do sieci');
  assert.match(r2.blad, /10 cyfr/);

  const awaria = async () => { throw new Error('Network request failed'); };
  const r3 = await pobierzDanePoNip('5250007738', { fetchFn: awaria, dzisiaj: '2026-10-23T00:00:00Z' });
  assert.equal(r3.dane, null);
  assert.match(r3.blad, /połącz/i);
});
