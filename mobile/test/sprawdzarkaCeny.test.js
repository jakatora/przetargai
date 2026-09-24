import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sprawdzWiersz,
  sprawdzFormularz,
  walidujFormularz,
  maBladPozycji,
  VAT_MAX,
} from '../src/lib/sprawdzarkaCeny.js';

test('wiersz: wartość netto = ilość × cena; VAT i brutto poprawnie', () => {
  const w = sprawdzWiersz({ ilosc: 10, cenaJedn: 25.5, vat: 23 });
  assert.equal(w.obliczona, 255);
  assert.equal(w.vatKwota, 58.65);
  assert.equal(w.brutto, 313.65);
  assert.equal(w.maDane, true);
  assert.equal(w.bladWartosci, false);
});

test('wykrywa błąd, gdy wartość z formularza ≠ obliczona', () => {
  const zly = sprawdzWiersz({ ilosc: 10, cenaJedn: 25.5, vat: 23, wartoscPodana: 250 });
  assert.equal(zly.bladWartosci, true);
  assert.equal(zly.obliczona, 255);
  const ok = sprawdzWiersz({ ilosc: 10, cenaJedn: 25.5, vat: 23, wartoscPodana: 255 });
  assert.equal(ok.bladWartosci, false);
});

test('polski przecinek w ilości/cenie/wartości', () => {
  const w = sprawdzWiersz({ ilosc: '2,5', cenaJedn: '1 000,40', vat: '8', wartoscPodana: '2 501,00' });
  assert.equal(w.obliczona, 2501); // 2,5 × 1000,40 = 2501,00
  assert.equal(w.vatKwota, 200.08); // 8% z 2501
  assert.equal(w.bladWartosci, false); // podana 2501,00 == obliczona → brak błędu
});

test('formularz: sumy netto/VAT/brutto z aktywnych wierszy', () => {
  const w = sprawdzFormularz([
    { ilosc: 10, cenaJedn: 100, vat: 23 },     // 1000 netto, 230 VAT
    { ilosc: 5, cenaJedn: 200, vat: 8 },       // 1000 netto, 80 VAT
    { ilosc: '', cenaJedn: '', vat: 23 },      // pusty → pomijany
  ]);
  assert.equal(w.aktywnych, 2);
  assert.equal(w.sumaNetto, 2000);
  assert.equal(w.sumaVat, 310);
  assert.equal(w.sumaBrutto, 2310);
  assert.equal(w.liczbaBledow, 0);
});

test('formularz: zbiera błędy z wierszy z niezgodną wartością', () => {
  const w = sprawdzFormularz([
    { nazwa: 'Poz. A', ilosc: 3, cenaJedn: 100, vat: 23, wartoscPodana: 300 }, // ok
    { nazwa: 'Poz. B', ilosc: 4, cenaJedn: 50, vat: 23, wartoscPodana: 210 },  // powinno 200 → błąd
  ]);
  assert.equal(w.liczbaBledow, 1);
  assert.equal(w.bledy[0].nazwa, 'Poz. B');
  assert.equal(w.bledy[0].obliczona, 200);
  assert.equal(w.bledy[0].podana, 210);
  assert.equal(w.bledy[0].indeks, 1);
});

test('puste/niepoprawne wejście → zera, bez wywrotki', () => {
  const w = sprawdzFormularz([]);
  assert.equal(w.aktywnych, 0);
  assert.equal(w.sumaBrutto, 0);
  assert.equal(w.liczbaBledow, 0);
  assert.deepEqual(sprawdzFormularz(null).pozycje, []);
});

// ─── walidacja pól (pozycje dynamiczne → błędy per pozycja, klucz pole_indeks) ─
// Dotąd „1.200,50" w wartości z formularza dawało po cichu 0 → fałszywe
// „W formularzu masz 0,00 zł", a VAT 230 liczył się bez ostrzeżenia.

test('walidujFormularz: puste pola i pusta lista = brak błędów (stan pusty ekranu)', () => {
  assert.deepEqual(walidujFormularz([{ ilosc: '', cenaJedn: '', vat: '', wartoscPodana: '' }]), { bledy: {}, maBledy: false });
  assert.deepEqual(walidujFormularz([]), { bledy: {}, maBledy: false });
  assert.deepEqual(walidujFormularz(undefined), { bledy: {}, maBledy: false });
});

test('walidujFormularz: poprawne liczby, także „1 200,50" = brak błędów', () => {
  const w = walidujFormularz([
    { ilosc: '2,5', cenaJedn: '1 200,50', vat: '23', wartoscPodana: '3 001,25' },
    { ilosc: '10', cenaJedn: '100', vat: '0', wartoscPodana: '' },
  ]);
  assert.deepEqual(w, { bledy: {}, maBledy: false });
});

test('walidujFormularz: „1.200,50" = błąd przy konkretnej pozycji i polu', () => {
  const { bledy, maBledy } = walidujFormularz([
    { ilosc: '1', cenaJedn: '100', vat: '23', wartoscPodana: '100' },
    { ilosc: '1.200,50', cenaJedn: '1.200,50', vat: '23', wartoscPodana: '1.200,50' },
  ]);
  assert.equal(maBledy, true);
  assert.equal(bledy.ilosc_1, 'Podaj liczbę, np. 10');
  assert.equal(bledy.cenaJedn_1, 'Podaj kwotę jako liczbę, np. 1200,00');
  assert.equal(bledy.wartoscPodana_1, 'Podaj kwotę jako liczbę, np. 1200,00');
  assert.equal(bledy.cenaJedn_0, undefined, 'poprawna pozycja bez błędu');
});

test('walidujFormularz: stawka VAT spoza zakresu 0–23% i ujemne kwoty = błąd', () => {
  assert.equal(VAT_MAX, 23);
  assert.equal(walidujFormularz([{ vat: '230' }]).bledy.vat_0, 'Stawka VAT spoza zakresu 0–23%');
  assert.equal(walidujFormularz([{ vat: '23' }]).maBledy, false);
  assert.equal(walidujFormularz([{ cenaJedn: '-5' }]).bledy.cenaJedn_0, 'Kwota nie może być ujemna');
  assert.equal(walidujFormularz([{ ilosc: '-1' }]).bledy.ilosc_0, 'Wartość musi wynosić co najmniej 0');
});

test('maBladPozycji: wskazuje tylko pozycję z błędem (indeks 1 ≠ 11)', () => {
  const lista = Array.from({ length: 12 }, () => ({ ilosc: '1', cenaJedn: '1', vat: '23' }));
  lista[11] = { ilosc: '1', cenaJedn: '1', vat: '99' };
  const { bledy } = walidujFormularz(lista);
  assert.equal(maBladPozycji(bledy, 11), true);
  assert.equal(maBladPozycji(bledy, 1), false);
  assert.equal(maBladPozycji(undefined, 0), false);
});
