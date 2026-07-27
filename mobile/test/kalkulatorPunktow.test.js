import { test } from 'node:test';
import assert from 'node:assert/strict';

import { punktKryterium, analizaPunktow } from '../src/lib/kalkulatorPunktow.js';

test('punktKryterium: „większe lepiej" — pełne punkty dla najlepszej wartości', () => {
  assert.equal(punktKryterium(60, 36, 40, 'max'), 40);       // 40 × 60/60
  assert.equal(punktKryterium(36, 60, 40, 'max'), 24);       // 40 × 36/60
});

test('punktKryterium: „mniejsze lepiej" (termin) — pełne dla najkrótszego', () => {
  assert.equal(punktKryterium(30, 60, 20, 'min'), 20);       // 20 × 30/30
  assert.equal(punktKryterium(60, 30, 20, 'min'), 10);       // 20 × 30/60
});

test('punktKryterium: brzegi (waga ≤ 0, wartości ≤ 0) → 0', () => {
  assert.equal(punktKryterium(10, 5, 0, 'max'), 0);
  assert.equal(punktKryterium(0, 0, 40, 'max'), 0);
});

test('analizaPunktow: wygrywam jakością mimo wyższej ceny; liczy cenę break-even', () => {
  const w = analizaPunktow({
    mojaCena: 520000,
    konkurencyjnaCena: 500000,
    wagaCeny: 60,
    kryteria: [{ nazwa: 'Gwarancja', waga: 40, kierunek: 'max', moje: 60, konkurent: 36 }],
  });
  assert.equal(w.rozbicie[0].moje, 40);
  assert.equal(w.rozbicie[0].konkurent, 24);
  assert.equal(w.konkCenaPkt, 60);
  assert.ok(Math.abs(w.mojaCenaPkt - 57.69) < 0.02);
  assert.ok(Math.abs(w.mojePkt - 97.69) < 0.02);
  assert.equal(w.konkPkt, 84);
  assert.equal(w.wygrywam, true);
  // 60 × 500000 / (84 − 40) = 681818
  assert.equal(w.cenaBreakEven, 681818);
  assert.ok(Math.abs(w.pctRoznica - 0.3636) < 0.001);
  assert.equal(w.bezLimitu, false);
});

test('analizaPunktow: przewaga jakością przewyższa całą wagę ceny → bez limitu ceny', () => {
  const w = analizaPunktow({
    mojaCena: 500000,
    konkurencyjnaCena: 500000,
    wagaCeny: 20,
    kryteria: [{ nazwa: 'Gwarancja', waga: 80, kierunek: 'max', moje: 60, konkurent: 10 }],
  });
  assert.equal(w.bezLimitu, true);
  assert.equal(w.cenaBreakEven, null);
  assert.equal(w.wygrywam, true);
});

test('analizaPunktow: sama cena (brak kryteriów pozacenowych) — tańszy wygrywa', () => {
  const w = analizaPunktow({ mojaCena: 510000, konkurencyjnaCena: 500000, wagaCeny: 100, kryteria: [] });
  assert.equal(w.konkPkt, 100);        // konkurent najtańszy = pełne 100
  assert.ok(w.mojePkt < 100);
  assert.equal(w.wygrywam, false);
  assert.equal(w.cenaBreakEven, 500000); // muszę zejść do ceny konkurenta
});

test('analizaPunktow: odporność na śmieci (NaN/puste) nie wywala', () => {
  const w = analizaPunktow({});
  assert.equal(w.mojePkt, 0);
  assert.equal(w.konkPkt, 0);
  assert.equal(w.wygrywam, true); // 0 ≥ 0
});
