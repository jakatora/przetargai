import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policzKary, walidujKary } from '../src/lib/karyUmowne.js';

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

test('dni do limitu w GÓRĘ: 0,3%/dzień, limit 20%, 1 mln → 67 (po 66 dniach kara 198 000 < limitu)', () => {
  const baza = { wartosc: 1000000, stawkaZwlokiProc: '0,3', limitProc: 20 };
  const w = policzKary({ ...baza, dniZwloki: 0 });
  assert.equal(w.dniDoLimitu, 67);
  const po66 = policzKary({ ...baza, dniZwloki: 66 });
  assert.equal(po66.karaZwloki, 198000);
  assert.ok(po66.karaZwloki < po66.limitKwota, 'po 66 dniach limit NIE jest jeszcze wyczerpany');
  const po67 = policzKary({ ...baza, dniZwloki: 67 });
  assert.ok(po67.karaZwloki >= po67.limitKwota, 'po 67 dniach limit wyczerpany');
});

test('dni do limitu: zgodne z kwotami na ekranie dla różnych stawek (pierwszy dzień z karą ≥ limit)', () => {
  for (const stawka of ['0,01', '0,05', '0,1', '0,15', '0,2', '0,25', '0,3', '0,5', '0,7', '1', '1,5']) {
    for (const limit of ['10', '15', '20', '25', '30']) {
      for (const wartosc of ['1000000', '123456,78', '99,99']) {
        const { dniDoLimitu: n, limitKwota } = policzKary({ wartosc, stawkaZwlokiProc: stawka, limitProc: limit });
        const kara = (dni) => policzKary({ wartosc, stawkaZwlokiProc: stawka, dniZwloki: dni }).karaZwloki;
        const opis = `stawka ${stawka}%, limit ${limit}%, wartość ${wartosc}`;
        assert.ok(kara(n) >= limitKwota, `${opis}: po ${n} dniach limit wyczerpany`);
        assert.ok(kara(n - 1) < limitKwota, `${opis}: po ${n - 1} dniach jeszcze nie`);
      }
    }
  }
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

test('grosze odporne na float: 10,35 zł × 10% = 1,035 → 1,04; 29 zł × 0,5% × 7 dni = 1,015 → 1,02', () => {
  const odst = policzKary({ wartosc: '10,35', odstapienieProc: '10' });
  assert.equal(odst.karaOdstapienia, 1.04);
  const zw = policzKary({ wartosc: '29', stawkaZwlokiProc: '0,5', dniZwloki: '7' });
  assert.equal(zw.karaZwloki, 1.02);
  const oba = policzKary({ wartosc: '10,35', stawkaZwlokiProc: '0,5', dniZwloki: '1', odstapienieProc: '10' });
  assert.equal(oba.suma, 1.09); // 0,05 (0,05175) + 1,04 — suma zaokrąglonych kwot co do grosza
});

test('bez wartości umowy → maDane false, zera', () => {
  const w = policzKary({ stawkaZwlokiProc: 0.2, dniZwloki: 10 });
  assert.equal(w.maDane, false);
  assert.equal(w.suma, 0);
  assert.equal(w.doZaplaty, 0);
});

// ---------------- walidujKary: jawne błędy zamiast cichego zera ----------------

test('walidujKary: puste pola → brak błędów (stan pusty, nie błąd)', () => {
  const w = walidujKary({ wartosc: '', stawkaZwlokiProc: '   ', dniZwloki: undefined, odstapienieProc: null, limitProc: '' });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujKary: poprawne dane (także „1 200 000,50" i „0,2") → brak błędów', () => {
  const w = walidujKary({ wartosc: '1 200 000,50', stawkaZwlokiProc: '0,2', dniZwloki: '14', odstapienieProc: '10', limitProc: '20' });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujKary: „1.200,50" (kropka tysięcy) → komunikat zamiast cichego 0', () => {
  const w = walidujKary({ wartosc: '1.200,50' });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.wartosc, 'Podaj kwotę jako liczbę, np. 1200,00');
});

test('walidujKary: stawka zwłoki spoza 0–10% dziennie (np. „20" zamiast „0,20") → komunikat', () => {
  const w = walidujKary({ wartosc: '100000', stawkaZwlokiProc: '20' });
  assert.equal(w.bledy.stawkaZwlokiProc, 'Kara za zwłokę spoza zakresu 0–10%');
  assert.equal(walidujKary({ stawkaZwlokiProc: '1.200,5' }).bledy.stawkaZwlokiProc, 'Podaj procent jako liczbę, np. 10');
});

test('walidujKary: dni zwłoki — całkowite, 0–3650', () => {
  assert.equal(walidujKary({ dniZwloki: '2,5' }).bledy.dniZwloki, 'Podaj liczbę całkowitą');
  assert.equal(walidujKary({ dniZwloki: '4000' }).bledy.dniZwloki, 'Wartość nie może przekraczać 3650');
  assert.equal(walidujKary({ dniZwloki: '0' }).maBledy, false);
});

test('walidujKary: odstąpienie i limit kar spoza 0–100% → komunikat z etykietą', () => {
  const w = walidujKary({ odstapienieProc: '150', limitProc: '120' });
  assert.equal(w.bledy.odstapienieProc, 'Kara za odstąpienie spoza zakresu 0–100%');
  assert.equal(w.bledy.limitProc, 'Limit kar spoza zakresu 0–100%');
});

test('walidujKary: wartość ujemna → komunikat; bez argumentów nie wywraca funkcji', () => {
  assert.equal(walidujKary({ wartosc: -5 }).bledy.wartosc, 'Kwota nie może być ujemna');
  assert.deepEqual(walidujKary(), { bledy: {}, maBledy: false });
});
