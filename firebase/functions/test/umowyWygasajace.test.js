import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { okresUmowy, parsujWynik } from '../src/lib/wynikiParser.js';
import {
  koniecUmowyWyniku, czyCykliczna, pozycjaUmowy, zbudujKubelkiUmow, kluczeUmowUzytkownika, wybierzUmowy, MIN_DLUGOSC_DNI,
} from '../src/lib/umowyWygasajace.js';

/*
 * Radar wygasających umów (2026-10-31). Fixture = trzy prawdziwe ogłoszenia o wyniku z BZP
 * (26–28.10.2026; adresy e-mail zamienione na example.pl): sprzątanie „do 2027-12-31” w dwóch
 * częściach, przeglądy obiektów „2 miesiące”, budowa magazynu „do 2026-12-15”.
 */
const WYNIKI = JSON.parse(readFileSync(new URL('./fixtures/wyniki-okres-umowy.json', import.meta.url), 'utf8'));
const poNumerze = (nr) => parsujWynik(WYNIKI.find((w) => w.bzpNumber === nr));
const TERAZ = Date.parse('2026-10-31T08:00:00.000Z');

test('okres 8.3: data końcowa, miesiące, dni, „od … do …”, stopka BZP przy łamaniu strony, literówki', () => {
  assert.deepEqual(okresUmowy('do 2026-12-15', '2026-10-07'), { okres: 'do 2026-12-15', koniec: '2026-12-15' });
  assert.equal(okresUmowy('12 miesiące', '2026-10-07').koniec, '2027-10-07');
  assert.equal(okresUmowy('12 miesięcy', '2026-01-31').koniec, '2027-01-31');
  assert.equal(okresUmowy('1 miesiąc', '2026-01-31').koniec, '2026-02-28', 'koniec miesiąca przycięty');
  assert.equal(okresUmowy('365 dni', '2026-10-07').koniec, '2027-10-07');
  assert.equal(okresUmowy('Od 2026-01-01 do 2026-12-31', null).koniec, '2026-12-31');
  assert.deepEqual(okresUmowy('24 miesięcy 2026-10-29 Biuletyn Zamówień Publicznych Ogłoszenie o wyniku postępowania - - Dostawy', '2026-01-31'), { okres: '24 miesięcy', koniec: '2028-01-31' });
  assert.equal(okresUmowy('36 miesięcy', null).koniec, null, 'bez daty umowy długości nie przeliczymy');
  assert.equal(okresUmowy('999 lat', '2026-01-01').koniec, null);
  assert.equal(okresUmowy('do 2026-10-15', '2026-10-20').koniec, null, 'koniec przed zawarciem');
  assert.deepEqual(okresUmowy(null, '2026-10-01'), { okres: null, koniec: null });
});

test('parser wyników na prawdziwych ogłoszeniach: okres i koniec każdej części', () => {
  const sprzatanie = poNumerze('2026/BZP 00507122');
  assert.deepEqual(sprzatanie.czesci.map((c) => [c.dataUmowy, c.okresUmowy, c.koniecUmowy]), [
    ['2026-10-26', 'do 2027-12-31', '2027-12-31'],
    ['2026-10-26', 'do 2027-12-31', '2027-12-31'],
  ]);
  assert.equal(poNumerze('2026/BZP 00507161').czesci[0].koniecUmowy, '2026-12-28');
  assert.equal(koniecUmowyWyniku(sprzatanie), '2027-12-31');
  assert.equal(koniecUmowyWyniku({ czesci: [{ uniewaznione: true, koniecUmowy: '2027-01-01' }] }), null);
});

test('cykliczność: sprzątanie na 14 miesięcy tak; przeglądy na 2 miesiące nie; budowa magazynu nie, utrzymanie dróg tak', () => {
  const sprzatanie = poNumerze('2026/BZP 00507122');
  assert.equal(czyCykliczna({ rodzaj: sprzatanie.rodzaj, tytul: sprzatanie.tytul, dataUmowy: '2026-10-26', koniec: '2027-12-31' }), true);
  assert.equal(czyCykliczna({ rodzaj: 'Services', tytul: 'Przeglądy', dataUmowy: '2026-10-28', koniec: '2026-12-28' }), false);
  const magazyn = poNumerze('2026/BZP 00507106');
  assert.equal(czyCykliczna({ rodzaj: magazyn.rodzaj, tytul: magazyn.tytul, dataUmowy: '2025-10-07', koniec: '2026-12-15' }), false);
  assert.equal(czyCykliczna({ rodzaj: 'Works', tytul: 'Bieżące utrzymanie dróg gminnych', dataUmowy: '2025-11-01', koniec: '2026-10-31' }), true);
  assert.equal(czyCykliczna({ rodzaj: 'Delivery', tytul: 'Paliwo', dataUmowy: null, koniec: '2027-01-01' }), true, 'bez daty umowy decyduje rodzaj');
  assert.ok(MIN_DLUGOSC_DNI >= 150);
});

const umowa = (id, { koniec, dataUmowy = '2025-12-01', woj = '18', cpv = ['90910000-9'], rodzaj = 'Services', nip = '7010000001', tytul = 'Sprzątanie' } = {}) => ({
  externalId: id, tytul, zamawiajacy: `Gmina ${id}`, zamawiajacyNip: '7490005094', wojewodztwo: woj, cpv, rodzaj, tenderId: `ocds-${id}`,
  czesci: [{ numer: 1, uniewaznione: false, dataUmowy, okresUmowy: '12 miesięcy', koniecUmowy: koniec, wartoscUmowy: 120_000, zwyciezca: { nazwa: `Firma ${nip}`, nip } }],
});

test('kubełki: tylko koniec w oknie, dział × województwo i dział w kraju, najbliżej końca pierwsze', () => {
  const wyniki = [
    umowa('a', { koniec: '2027-01-15' }),
    umowa('b', { koniec: '2026-11-20' }),
    umowa('c', { koniec: '2026-10-30' }), // już po terminie
    umowa('d', { koniec: '2027-12-31' }), // poza horyzontem 210 dni
    umowa('e', { koniec: '2027-02-01', woj: '14', cpv: ['90910000-9', '79710000-4'] }),
    umowa('f', { koniec: '2026-12-01', dataUmowy: '2026-10-01' }), // 2 miesiące — jednorazowe
  ];
  const k = zbudujKubelkiUmow(wyniki, { teraz: TERAZ });
  assert.deepEqual(Object.keys(k).sort(), ['79', '79|14', '90', '90|14', '90|18']);
  assert.deepEqual(k['90|18'].umowy.map((u) => u.id), ['b', 'a']);
  assert.deepEqual(k['90'].umowy.map((u) => u.id), ['b', 'a', 'e']);
  const poz = k['90|18'].umowy[0];
  assert.deepEqual([poz.koniec, poz.wartosc, poz.zwyciezcy[0].nip, poz.data_umowy, poz.postepowanie_id], ['2026-11-20', 120000, '7010000001', '2025-12-01', 'ocds-b']);
  assert.equal(pozycjaUmowy(umowa('g', { koniec: '2027-01-01' }), { odDnia: '2026-10-31', doDnia: '2027-05-29' }).liczba_wykonawcow, 1);
});

test('lista dla firmy: klucze z karty, bez własnych umów i bez zakończonych, dni do końca, nazwa regionu', () => {
  assert.deepEqual(kluczeUmowUzytkownika({ cpv_codes: ['90910000-9', '90911200-8'], regiony: ['PL18'] }).klucze, ['90|18']);
  assert.deepEqual(kluczeUmowUzytkownika({ cpv_codes: ['90910000-9'], regiony: [] }).klucze, ['90']);
  assert.deepEqual(kluczeUmowUzytkownika({}).dzialy, []);
  const k = zbudujKubelkiUmow([umowa('a', { koniec: '2027-01-15' }), umowa('b', { koniec: '2026-11-20', nip: '5830001675' })], { teraz: TERAZ });
  const { umowy, w_kubelkach: wKubelkach } = wybierzUmowy({ kubelki: { '90|18': k['90|18'] }, teraz: TERAZ, wlasnyNip: '583-000-16-75' });
  assert.deepEqual(umowy.map((u) => u.id), ['a'], 'umowa, którą firma sama wykonuje, nie jest dla niej leadem');
  assert.equal(umowy[0].dni_do_konca, 76);
  assert.equal(umowy[0].region_nazwa, 'Podkarpackie');
  assert.equal(wKubelkach, 2);
  const pozniej = wybierzUmowy({ kubelki: { '90|18': k['90|18'] }, teraz: Date.parse('2026-12-01T08:00:00.000Z') });
  assert.deepEqual(pozniej.umowy.map((u) => u.id), ['a'], 'zakończona po przeliczeniu kubełka znika przy odczycie');
});
