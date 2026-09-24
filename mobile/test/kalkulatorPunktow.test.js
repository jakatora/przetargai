import { test } from 'node:test';
import assert from 'node:assert/strict';

import { punktKryterium, analizaPunktow, walidujPunkty, poleKryterium } from '../src/lib/kalkulatorPunktow.js';

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

test('poleKryterium: klucz błędu pola kryterium to „kryteria.<indeks>.<pole>"', () => {
  assert.equal(poleKryterium(1, 'waga'), 'kryteria.1.waga');
});

test('walidujPunkty: puste pola → brak błędów (stan pusty, nie błąd)', () => {
  const w = walidujPunkty({
    mojaCena: '', konkurencyjnaCena: '   ', wagaCeny: '',
    kryteria: [{ waga: '', moje: '', konkurent: undefined }],
  });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujPunkty: poprawne liczby (też „520 000,50") → brak błędów', () => {
  const w = walidujPunkty({
    mojaCena: '520 000,50', konkurencyjnaCena: '500000', wagaCeny: '60',
    kryteria: [{ waga: '40', moje: '60', konkurent: '36,5' }],
  });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujPunkty: „1.200,50" (kropka tysięcy) → komunikat zamiast cichego 0', () => {
  const w = walidujPunkty({
    mojaCena: '1.200,50', konkurencyjnaCena: '500000', wagaCeny: '60',
    kryteria: [{ waga: '40', moje: '60', konkurent: '1.200,50' }],
  });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.mojaCena, 'Podaj kwotę jako liczbę, np. 1200,00');
  assert.equal(w.bledy['kryteria.0.konkurent'], 'Podaj liczbę, np. 10');
});

test('walidujPunkty: waga ceny i waga kryterium poza 0–100 pkt, ujemna wartość → komunikat', () => {
  const w = walidujPunkty({
    mojaCena: '520000', konkurencyjnaCena: '-5', wagaCeny: '120',
    kryteria: [
      { waga: '40', moje: '60', konkurent: '36' },
      { waga: '150', moje: '-3', konkurent: '30' },
    ],
  });
  assert.equal(w.bledy.konkurencyjnaCena, 'Kwota nie może być ujemna');
  assert.equal(w.bledy.wagaCeny, 'Wartość nie może przekraczać 100');
  assert.equal(w.bledy['kryteria.1.waga'], 'Wartość nie może przekraczać 100');
  assert.equal(w.bledy['kryteria.1.moje'], 'Wartość musi wynosić co najmniej 0');
  assert.equal(w.bledy['kryteria.0.waga'], undefined);
});

test('walidujPunkty: bez argumentów nie wywraca funkcji', () => {
  const w = walidujPunkty();
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});
