import { test } from 'node:test';
import assert from 'node:assert/strict';
import { znacznikZmian, opisWyboru } from '../src/lib/zmianyDokumentow.js';

test('znacznik zmian w dokumentacji na karcie listy', () => {
  assert.deepEqual(znacznikZmian({ ez_zmiany: { wyjasnienia: 2, zmiany: 1, termin: 1 } }), { pl: 'Nowy termin · Zmiany SWZ (1) · Wyjaśnienia (2)', en: 'New deadline · Document changes (1) · Clarifications (2)' });
  assert.deepEqual(znacznikZmian({ ez_zmiany: { wyjasnienia: 1, zmiany: 0, termin: 0 } }).pl, 'Wyjaśnienia (1)');
  assert.equal(znacznikZmian({ ez_zmiany: { wyjasnienia: 0, zmiany: 0, termin: 0 } }), null);
  assert.equal(znacznikZmian({}), null);
  assert.equal(znacznikZmian(null), null);
});

test('otwarcie ofert: skrót na kartę i zdanie na ekran ogłoszenia', async () => {
  const { znacznikOtwarcia, opisOtwarcia } = await import('../src/lib/zmianyDokumentow.js');
  const t = (pl) => pl;
  const tender = { otwarcie_ofert: { kwota: 195457.23, oferty: 6, cena_min: 158694.93, cena_max: 552963.59, czesci: false } };
  assert.equal(znacznikOtwarcia(tender, t), 'Otwarcie: 6 ofert · od 159 tys. zł');
  assert.equal(opisOtwarcia(tender, t), '6 ofert z ceną: od 159 tys. zł do 553 tys. zł; zamawiający przeznaczył 195 tys. zł.');
  assert.equal(znacznikOtwarcia({ otwarcie_ofert: { kwota: 527143.56, oferty: null } }, t), 'Budżet zamawiającego: 527 tys. zł');
  assert.equal(znacznikOtwarcia({ otwarcie_ofert: { kwota: null, oferty: 2, cena_min: 347721, cena_max: 451656 } }, t), 'Otwarcie: 2 oferty · od 348 tys. zł');
  const en = (_, e) => e;
  assert.equal(znacznikOtwarcia(tender, en), 'Opening: 6 bids · from PLN 159k');
  assert.equal(znacznikOtwarcia({}, t), null);
});

test('opisWyboru: kto wybrany i ile ofert; części; bez danych null', () => {
  const t = (pl) => pl;
  assert.equal(opisWyboru({ wybor_oferty: { wykonawcy: [{ czesc: null, nazwa: 'RR-BUD Sp. z o.o.' }], oferty: 3 } }, t), 'RR-BUD Sp. z o.o. (3 oferty)');
  assert.equal(opisWyboru({ wybor_oferty: { wykonawcy: [{ czesc: 1, nazwa: 'A' }, { czesc: 2, nazwa: 'B' }], oferty: null } }, t), 'cz. 1: A; cz. 2: B');
  assert.equal(opisWyboru({ wybor_oferty: null }, t), null);
  assert.equal(opisWyboru({}, t), null);
});
