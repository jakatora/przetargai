import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policzKary } from '../src/lib/karyUmowne.js';

const BAZA = { wartosc: 1000000, stawkaZwlokiProc: 0.2, odstapienieProc: 10, limitProc: 20 };

test('kara za zwłokę = wartość × stawka% × dni; odstąpienie = wartość × %', () => {
  const w = policzKary({ ...BAZA, dniZwloki: 10 });
  assert.equal(w.karaZwloki, 20000); // 0,2% z 1 mln = 2000/dzień × 10
  assert.equal(w.karaOdstapienia, 100000); // 10% z 1 mln
  assert.equal(w.suma, 120000);
  assert.equal(w.limitKwota, 200000); // 20%
  assert.equal(w.przekroczono, false);
  assert.equal(w.doZaplaty, 120000);
  assert.equal(w.maDane, true);
});

test('limit kar przycina sumę i sygnalizuje przekroczenie', () => {
  const w = policzKary({ ...BAZA, dniZwloki: 60 }); // zwłoka 120000 + 100000 = 220000 > 200000
  assert.equal(w.suma, 220000);
  assert.equal(w.przekroczono, true);
  assert.equal(w.doZaplaty, 200000, 'kara do zapłaty przycięta do limitu');
});

test('dni do wyczerpania limitu SAMĄ zwłoką', () => {
  const w = policzKary({ ...BAZA, dniZwloki: 0 });
  assert.equal(w.dniDoLimitu, 100); // 200000 / 2000
});

test('brak limitu → doZaplaty = suma, dniDoLimitu null', () => {
  const w = policzKary({ wartosc: 500000, stawkaZwlokiProc: 0.5, dniZwloki: 5, limitProc: '' });
  assert.equal(w.limitKwota, null);
  assert.equal(w.przekroczono, false);
  assert.equal(w.doZaplaty, w.suma);
  assert.equal(w.dniDoLimitu, null);
});

test('polski przecinek i puste/niepoprawne pola', () => {
  const w = policzKary({ wartosc: '1 000 000', stawkaZwlokiProc: '0,2', dniZwloki: '15', odstapienieProc: '', limitProc: '' });
  assert.equal(w.karaZwloki, 30000); // 2000 × 15
  assert.equal(w.karaOdstapienia, 0);
  assert.equal(w.suma, 30000);
});

test('bez wartości umowy → maDane false, zera', () => {
  const w = policzKary({ stawkaZwlokiProc: 0.2, dniZwloki: 10 });
  assert.equal(w.maDane, false);
  assert.equal(w.suma, 0);
  assert.equal(w.doZaplaty, 0);
});
