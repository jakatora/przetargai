import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policzCene, walidujCene, formatujPLN, STAWKI_VAT } from '../src/lib/kalkulatorCeny.js';

test('prosty przypadek: sam koszt + VAT 23%', () => {
  const w = policzCene({ material: 1000, vatProc: 23 });
  assert.equal(w.bezposrednie, 1000);
  assert.equal(w.netto, 1000);
  assert.equal(w.vat, 230);
  assert.equal(w.brutto, 1230);
  assert.equal(w.maDane, true);
});

test('pełny łańcuch: narzut → zysk → VAT (kwoty i udział zysku)', () => {
  const w = policzCene({ material: 700, robocizna: 300, inne: 0, narzutProc: 10, zyskProc: 20, vatProc: 23 });
  assert.equal(w.bezposrednie, 1000);
  assert.equal(w.posrednie, 100); // 10% z 1000
  assert.equal(w.kosztWytworzenia, 1100);
  assert.equal(w.zysk, 220); // 20% z 1100
  assert.equal(w.netto, 1320);
  assert.equal(w.vat, 303.6); // 23% z 1320
  assert.equal(w.brutto, 1623.6);
  assert.equal(w.udzialZyskuProc, 16.67); // 220/1320
});

test('VAT 0% → brutto = netto', () => {
  const w = policzCene({ material: 500, robocizna: 500, vatProc: 0 });
  assert.equal(w.netto, 1000);
  assert.equal(w.vat, 0);
  assert.equal(w.brutto, 1000);
  assert.ok(STAWKI_VAT.includes(0));
});

test('wejście z przecinkiem i spacjami parsuje się poprawnie', () => {
  const w = policzCene({ material: '1 000,50', vatProc: 23 });
  assert.equal(w.bezposrednie, 1000.5);
  assert.equal(w.brutto, 1230.62); // 1000,50 * 1,23 = 1230,615 → 1230,62
});

// ─── zaokrąglanie groszy odporne na float (2026-09-25) ───────────────────────
// VAT liczony od ZAOKRĄGLONEGO netto, brutto = netto + VAT — tabela zawsze sumuje się do grosza.

test('koszt 29,50 + VAT 23%: VAT 6,79 (6,785 w górę), brutto 36,29 = netto + VAT', () => {
  const w = policzCene({ material: '29,50', vatProc: 23 });
  assert.equal(w.netto, 29.5);
  assert.equal(w.vat, 6.79);
  assert.equal(w.brutto, 36.29);
});

test('100 zł, narzut 12,5%, zysk 7%, VAT 23% → netto 120,38, VAT 27,69, brutto 148,07', () => {
  const w = policzCene({ material: 100, narzutProc: '12,5', zyskProc: 7, vatProc: 23 });
  assert.equal(w.posrednie, 12.5);
  assert.equal(w.kosztWytworzenia, 112.5);
  assert.equal(w.zysk, 7.88); // 7,875 w górę
  assert.equal(w.netto, 120.38);
  assert.equal(w.vat, 27.69);
  assert.equal(w.brutto, 148.07);
});

test('PĘTLA: każdy wiersz tabeli sumuje się do grosza (koszt, netto, brutto)', () => {
  const gr = (x) => Math.round(x * 100);
  for (let g = 1; g <= 20000; g += 1) {
    const w = policzCene({ material: g / 100, narzutProc: 12.5, zyskProc: 7, vatProc: 23 });
    const ok = gr(w.kosztWytworzenia) === gr(w.bezposrednie) + gr(w.posrednie)
      && gr(w.netto) === gr(w.kosztWytworzenia) + gr(w.zysk)
      && gr(w.brutto) === gr(w.netto) + gr(w.vat)
      && gr(w.vat) === Math.floor((gr(w.netto) * 23 + 50) / 100);
    if (!ok) assert.fail(`materiał ${g / 100}: ${JSON.stringify(w)}`);
  }
});

test('formatujPLN: połówka grosza w górę także przy ogonie float (1,005 → 1,01)', () => {
  assert.equal(formatujPLN(1.005), '1,01 zł');
  assert.equal(formatujPLN(2.675), '2,68 zł');
});

test('puste / niepoprawne / ujemne pola → 0, maDane=false', () => {
  const w = policzCene({ material: '', robocizna: 'abc', inne: -50, narzutProc: 10, zyskProc: 20 });
  assert.equal(w.bezposrednie, 0);
  assert.equal(w.netto, 0);
  assert.equal(w.brutto, 0);
  assert.equal(w.udzialZyskuProc, 0);
  assert.equal(w.maDane, false);
});

test('policzCene() bez argumentów nie wywraca funkcji', () => {
  const w = policzCene();
  assert.equal(w.brutto, 0);
  assert.equal(w.maDane, false);
});

test('walidujCene: poprawne dane → brak błędów', () => {
  const w = walidujCene({ material: '1 200,00', robocizna: '300', inne: '0', narzutProc: '10', zyskProc: '20' });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujCene: puste pola → brak błędów (stan pusty, nie błąd)', () => {
  const w = walidujCene({ material: '', robocizna: '   ', inne: undefined, narzutProc: '', zyskProc: null });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujCene: same przecinki/spacje po oczysc → komunikat o liczbie', () => {
  const w = walidujCene({ material: ',,', narzutProc: '10' });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.material, 'Podaj kwotę jako liczbę, np. 1200,00');
});

test('walidujCene: kwota ujemna → komunikat o wartości ujemnej', () => {
  const w = walidujCene({ material: -50 });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.material, 'Kwota nie może być ujemna');
});

test('walidujCene: narzut poza zakresem 0–1000% → komunikat o narzucie', () => {
  const zaDuzy = walidujCene({ material: '1000', narzutProc: '1500' });
  assert.equal(zaDuzy.bledy.narzutProc, 'Narzut spoza zakresu 0–1000%');
  const ujemny = walidujCene({ material: '1000', narzutProc: '-5' });
  assert.equal(ujemny.bledy.narzutProc, 'Narzut spoza zakresu 0–1000%');
});

test('walidujCene: zysk poza zakresem 0–1000% → komunikat o zysku', () => {
  const w = walidujCene({ material: '1000', zyskProc: '2000' });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.zyskProc, 'Zysk spoza zakresu 0–1000%');
});

test('walidujCene: procent nienumeryczny → komunikat o liczbie', () => {
  const w = walidujCene({ material: '1000', narzutProc: ',' });
  assert.equal(w.bledy.narzutProc, 'Podaj procent jako liczbę, np. 10');
});

test('walidujCene: bez argumentów nie wywraca funkcji', () => {
  const w = walidujCene();
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('formatujPLN: polski format z groszami i separatorem tysięcy', () => {
  assert.equal(formatujPLN(12345.6), '12 345,60 zł');
  assert.equal(formatujPLN(1000), '1 000,00 zł');
  assert.equal(formatujPLN(0), '0,00 zł');
  assert.equal(formatujPLN(1623.615), '1 623,62 zł');
  assert.equal(formatujPLN(999999.99), '999 999,99 zł');
});
