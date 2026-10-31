import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profilKonkurenta, kluczeZwyciezcow, normNip } from '../src/lib/profilKonkurenta.js';

/*
 * Profil konkurenta (2026-10-31): co wygrywa jedna firma u wszystkich zamawiających.
 * BZP dopasowuje po NIP-ie, TED (bez NIP-u) po nazwie; kwoty tylko ze spójnych części.
 */
const czesc = (zwyciezca, { cena = 100_000, spojne = true, oferty = 3, pozycja = null, maly = false, uniewaznione = false } = {}) => (
  uniewaznione ? { uniewaznione: true } : { zwyciezca, cenaWybrana: cena, spojne, liczbaOfert: oferty, pozycjaCeny: pozycja, wygralMaly: maly, uniewaznione: false }
);
const BUDMAX = { nazwa: 'Budmax Sp. z o.o. ul. Polna 3 35-001 Rzeszów', nip: '813-000-00-01' };
const INNY_BUDMAX = { nazwa: 'Budmax Sp. z o.o.', nip: '5250000000' };

const WYNIKI = [
  { id: 'a', zrodlo: 'bzp', tytul: 'Remont szkoły', zamawiajacy: 'Gmina Trzebownisko', zamawiajacyNip: '8130000099', wojewodztwo: '18', rodzaj: 'Works', cpv: ['45000000-7'], opublikowano: '2026-09-01',
    czesci: [czesc(BUDMAX, { cena: 400_000, oferty: 2, pozycja: 0 }), czesc({ nazwa: 'Ktoś Inny', nip: '1111111111' })] },
  { id: 'b', zrodlo: 'bzp', tytul: 'Drogi gminne', zamawiajacy: 'GMINA TRZEBOWNISKO', zamawiajacyNip: '813-000-00-99', wojewodztwo: '18', rodzaj: 'Works', cpv: ['45233140-2'], opublikowano: '2026-10-10',
    czesci: [czesc(BUDMAX, { cena: 600_000, oferty: 4, pozycja: 0.5 }), czesc(BUDMAX, { cena: 999, spojne: false, oferty: 1 })] },
  { id: 'c', zrodlo: 'ted', tytul: 'Budowa hali', zamawiajacy: 'Miasto Rzeszów', zamawiajacyNip: null, wojewodztwo: '18', rodzaj: 'Works', cpv: ['45000000'], opublikowano: '2026-08-05',
    czesci: [czesc({ nazwa: 'BUDMAX SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', nip: null }, { cena: 2_000_000, oferty: 6 })] },
  { id: 'd', zrodlo: 'bzp', tytul: 'Inny Budmax z innym NIP-em', zamawiajacy: 'Powiat X', zamawiajacyNip: '7770000000', opublikowano: '2026-10-20',
    czesci: [czesc(INNY_BUDMAX)] },
];

test('profil po NIP-ie: wygrane BZP po NIP-ie + TED po nazwie; firma o tej samej nazwie i innym NIP-ie się nie liczy', () => {
  const p = profilKonkurenta([...WYNIKI, WYNIKI[0]], { nip: '8130000001', nazwa: 'Budmax Sp. z o.o.' });
  assert.equal(p.znaleziono, true);
  assert.equal(p.nip, '8130000001');
  assert.equal(p.nazwa, 'Budmax Sp. z o.o.', 'nazwa bez adresu, z ostatniej wygranej');
  assert.equal(p.wygrane, 4, 'a:1 + b:2 + c:1 (TED po nazwie), bez d (inny NIP) i bez duplikatu a');
  assert.equal(p.wartosc, 3_000_000, 'niespójna część b bez kwoty');
  assert.deepEqual([p.od, p.do], ['2026-08-05', '2026-10-10']);
  assert.deepEqual(p.zamawiajacy.map((z) => [z.nazwa, z.wygrane, z.wartosc]), [['GMINA TRZEBOWNISKO', 3, 1_000_000], ['Miasto Rzeszów', 1, 2_000_000]]);
  assert.equal(p.liczba_zamawiajacych, 2);
  assert.deepEqual(p.wojewodztwa, [{ kod: '18', nazwa: 'Podkarpackie', wygrane: 4 }]);
  assert.deepEqual(p.rodzaje, [{ rodzaj: 'Works', wygrane: 4 }]);
  assert.ok(p.branze.length >= 1 && p.branze[0].nazwa, 'branża z katalogu CPV');
  assert.equal(p.mediana_ofert, 3, 'oferty 2, 4, 1, 6 → mediana 3');
  assert.deepEqual(p.najnizsza_cena, { razy: 1, z: 2 });
  assert.deepEqual(p.ostatnie.map((o) => o.tytul), ['Drogi gminne', 'Remont szkoły', 'Budowa hali']);
  assert.equal(p.ostatnie[0].cena, 600_000);
  assert.deepEqual(p.zrodla, ['bzp', 'ted']);
});

test('profil po samej nazwie (zwycięzca z TED) i brak wygranych', () => {
  const p = profilKonkurenta(WYNIKI, { nazwa: 'BUDMAX SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ' });
  assert.equal(p.wygrane, 1, 'bez NIP-u dopasowuje tylko części bez NIP-u — firmy z NIP-em nie zgadujemy po nazwie');
  assert.equal(p.firm_o_tej_nazwie, 2, 'dwie firmy „Budmax” z różnymi NIP-ami — nie sklejamy');
  const jedna = profilKonkurenta(WYNIKI.slice(0, 3), { nazwa: 'BUDMAX SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ' });
  assert.deepEqual([jedna.wygrane, jedna.nip, jedna.firm_o_tej_nazwie], [4, '8130000001', null], 'jeden NIP o tej nazwie → to ta firma');
  const pusty = profilKonkurenta(WYNIKI, { nip: '9990000000' });
  assert.equal(pusty.znaleziono, false);
  assert.deepEqual([pusty.wartosc, pusty.zamawiajacy, pusty.najnizsza_cena], [null, [], null]);
});

test('klucze zwycięzców do zapisu: NIP-y 10-cyfrowe i nazwy bez formy prawnej, bez unieważnionych', () => {
  assert.deepEqual(kluczeZwyciezcow([
    czesc(BUDMAX), czesc({ nazwa: 'Budmax spółka z o.o.', nip: '8130000001' }), czesc({ nazwa: 'Firma TED', nip: null }),
    czesc({ nazwa: 'Zły NIP', nip: '123' }), czesc(null, { uniewaznione: true }),
  ]), { zwyciezcy_nip: ['8130000001'], zwyciezcy_nazwy: ['budmax', 'firma ted', 'zły nip'] });
  assert.equal(normNip('PL 813-000-00-01'), '8130000001');
  assert.equal(normNip('12345'), null);
});

test('Twoi konkurenci: region przed krajem, ta sama firma z kilku kubełków zsumowana, własna firma pominięta', async () => {
  const { twoiKonkurenci } = await import('../src/lib/profilKonkurenta.js');
  const kubelki = {
    'cpv:45|18': { najczestsiZwyciezcy: [{ nazwa: 'Budmax', nip: '8130000001', wygrane: 5, wartosc: 1_000_000 }, { nazwa: 'Moja Firma', nip: '9990000000', wygrane: 9, wartosc: 10 }] },
    'cpv:45|12': { najczestsiZwyciezcy: [{ nazwa: 'BUDMAX Sp. z o.o.', nip: null, wygrane: 2, wartosc: null }] },
    'cpv:45': { najczestsiZwyciezcy: [{ nazwa: 'Krajowy Gigant', nip: '5250000000', wygrane: 99, wartosc: 1 }] },
    'cpv:90': { najczestsiZwyciezcy: [{ nazwa: 'Eko Odpady', nip: '7770000000', wygrane: 4, wartosc: 200_000 }] },
    'cpv:90|18': { najczestsiZwyciezcy: [] },
  };
  const w = twoiKonkurenci({ dzialy: ['45', '90', '71'], regiony: ['18', '12'], kubelki, wlasnyNip: '999-000-00-00' });
  assert.deepEqual(w.zakresy.map((z) => [z.dzial, z.zakres]), [['45', 'region'], ['90', 'kraj']], 'dział 71 bez danych pominięty');
  assert.deepEqual(w.konkurenci.map((k) => [k.nazwa, k.nip, k.wygrane, k.wartosc]), [
    ['Budmax', '8130000001', 7, 1_000_000],
    ['Eko Odpady', '7770000000', 4, 200_000],
  ]);
  assert.equal(w.konkurenci[0].branze.length, 1);
});
