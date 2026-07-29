import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policzCene, formatujPLN, STAWKI_VAT } from '../src/lib/kalkulatorCeny.js';

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

test('formatujPLN: polski format z groszami i separatorem tysięcy', () => {
  assert.equal(formatujPLN(12345.6), '12 345,60 zł');
  assert.equal(formatujPLN(1000), '1 000,00 zł');
  assert.equal(formatujPLN(0), '0,00 zł');
  assert.equal(formatujPLN(1623.615), '1 623,62 zł');
  assert.equal(formatujPLN(999999.99), '999 999,99 zł');
});
