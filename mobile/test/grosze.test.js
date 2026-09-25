import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groszeIloczynu,
  iloczynDoGroszy,
  doGroszy,
  procentDoGroszy,
  sumaGroszy,
  ilorazWGore,
} from '../src/lib/grosze.js';

// Wspólne zaokrąglanie kwot do groszy (2026-09-25). `Math.round(n * 100) / 100` na liczbie
// zmiennoprzecinkowej myliło się na połówkach grosza (1,005 w pamięci to 1,00499999…).
// Wzorzec „dokładnie": ta sama wartość policzona na liczbach całkowitych, końcówka ≥ 0,5 gr w górę.

test('doGroszy: połówka grosza w górę także tam, gdzie float „gubi" 0,5 (1,005 · 2,675 · 1,045)', () => {
  assert.equal(doGroszy(1.005), 1.01);
  assert.equal(doGroszy(2.675), 2.68);
  assert.equal(doGroszy(1.045), 1.05);
  assert.equal(doGroszy(1.0049), 1);
  assert.equal(doGroszy(0.125), 0.13);
  assert.equal(doGroszy(-1.005), -1.01, 'ujemne: połówka od zera');
});

test('doGroszy: puste/niepoprawne wejście → 0, liczby w zapisie wykładniczym działają', () => {
  assert.equal(doGroszy(0), 0);
  assert.equal(doGroszy(NaN), 0);
  assert.equal(doGroszy(Infinity), 0);
  assert.equal(doGroszy(undefined), 0);
  assert.equal(doGroszy(1e-7), 0);
  assert.equal(doGroszy(0.005), 0.01);
  assert.equal(doGroszy(1.5e-3), 0);
  assert.equal(doGroszy(123456789.125), 123456789.13);
});

test('iloczynDoGroszy: przykłady z recenzji — 0,5 × 2,01 = 1,01 i 0,1 × 10,35 = 1,04', () => {
  assert.equal(iloczynDoGroszy([0.5, 2.01]), 1.01);
  assert.equal(iloczynDoGroszy([0.1, 10.35]), 1.04);
  assert.equal(iloczynDoGroszy(['0.5', '2.01']), 1.01, 'przyjmuje też zapis tekstowy z kropką');
  assert.equal(groszeIloczynu([0.5, 2.01]), 101);
});

test('iloczynDoGroszy z dzielnikiem: odsetki 20 805 zł × 11,75% × 30 dni / 365 = 200,925 → 200,93', () => {
  assert.equal(iloczynDoGroszy([20805, 11.75, 30], 36500), 200.93);
  assert.equal(iloczynDoGroszy([1, 1], 0), 0, 'dzielnik 0 → 0 zamiast Infinity');
});

test('procentDoGroszy: VAT 23% od 29,50 = 6,785 → 6,79', () => {
  assert.equal(procentDoGroszy(29.5, 23), 6.79);
  assert.equal(procentDoGroszy(120.38, 23), 27.69);
  assert.equal(procentDoGroszy(1000, 0), 0);
});

test('sumaGroszy: suma kwot groszowych bez ogona float (29,50 + 6,79 === 36,29)', () => {
  assert.equal(sumaGroszy([29.5, 6.79]), 36.29);
  assert.equal(sumaGroszy([0.1, 0.2]), 0.3);
  assert.equal(sumaGroszy([]), 0);
});

test('PĘTLA: ilość 0,1–10 × cena 0,01–50 — wynik = dokładne zaokrąglenie połówki w górę', () => {
  let sprawdzone = 0;
  for (let dziesiate = 1; dziesiate <= 100; dziesiate += 1) {
    const ilosc = dziesiate / 10; // ta sama liczba co wpisane „0.1"…„10"
    for (let gr = 1; gr <= 5000; gr += 1) {
      const cena = gr / 100; // ta sama liczba co wpisane „0.01"…„50"
      // Iloczyn w tysięcznych złotego: dziesiąte × grosze; grosze = ⌊(x + 5) / 10⌋.
      const oczekiwane = Math.floor((dziesiate * gr + 5) / 10);
      const wynik = groszeIloczynu([ilosc, cena]);
      if (wynik !== oczekiwane) {
        assert.fail(`${ilosc} × ${cena}: jest ${wynik} gr, powinno ${oczekiwane} gr`);
      }
      sprawdzone += 1;
    }
  }
  assert.equal(sprawdzone, 500000);
});

test('PĘTLA: VAT 23/8/5% od netto 0,01–500,00 — dokładnie, a brutto = netto + VAT co do grosza', () => {
  for (const stawka of [23, 8, 5]) {
    for (let gr = 1; gr <= 50000; gr += 1) {
      const netto = gr / 100;
      const vatGr = Math.floor((gr * stawka + 50) / 100);
      const vat = procentDoGroszy(netto, stawka);
      if (vat !== vatGr / 100) assert.fail(`VAT ${stawka}% od ${netto}: jest ${vat}, powinno ${vatGr / 100}`);
      const brutto = sumaGroszy([netto, vat]);
      if (brutto !== (gr + vatGr) / 100) assert.fail(`brutto ${netto} + ${vat}: jest ${brutto}`);
    }
  }
});

test('ilorazWGore: dokładne ⌈a / b⌉ na liczbach dziesiętnych (limit 20% / 0,3% dziennie = 67 dni)', () => {
  assert.equal(ilorazWGore(20, 0.3), 67);
  assert.equal(ilorazWGore(20, 0.2), 100, 'równo — bez „101" z ogona float');
  assert.equal(ilorazWGore(30, 0.1), 300);
  assert.equal(ilorazWGore(0.3, 0.1), 3);
  assert.equal(ilorazWGore(20, 0), null);
  assert.equal(ilorazWGore(20, -1), null);
});
