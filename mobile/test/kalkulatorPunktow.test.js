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

// ─── cena remisu (break-even) — niezależna od TWOJEJ obecnej ceny ───────────────
// Dotąd punkty konkurenta za cenę liczono przy Twojej obecnej cenie, a po przebiciu ceny
// konkurenta dostawał on pełną wagę — próg wychodził zawyżony albo „bez limitu".
// Sprawdzamy nie tylko liczbę, ale sens: przy progu nie przegrywasz, złotówkę wyżej — tak.

const GWARANCJA = (moje, konkurent) => [{ nazwa: 'Gwarancja', waga: 40, kierunek: 'max', moje, konkurent }];

test('cena remisu: Twoja cena < konkurenta, wygrywasz jakością → 40 + 6000/c = 24 + 60 → 136,36', () => {
  const baza = { konkurencyjnaCena: 100, wagaCeny: 60, kryteria: GWARANCJA(60, 36) };
  const w = analizaPunktow({ ...baza, mojaCena: 90 });
  assert.equal(w.cenaBreakEven, 136); // 136,36 → w dół: przy 136 jeszcze nie przegrywasz
  assert.ok(Math.abs(w.pctRoznica - 0.3636) < 0.001);
  assert.equal(w.bezLimitu, false);
  assert.equal(analizaPunktow({ ...baza, mojaCena: 136 }).wygrywam, true);
  const powyzej = analizaPunktow({ ...baza, mojaCena: 137 });
  assert.equal(powyzej.wygrywam, false); // 83,80 < 84
  assert.equal(powyzej.mojePkt, 83.8);
  assert.equal(powyzej.konkPkt, 84);
});

test('cena remisu: równe ceny, przegrywasz jakością → musisz zejść do 73,33 (nie 79)', () => {
  const baza = { konkurencyjnaCena: 100, wagaCeny: 60, kryteria: GWARANCJA(36, 60) };
  const w = analizaPunktow({ ...baza, mojaCena: 100 });
  // Poniżej ceny konkurenta: Ty masz pełne 60 za cenę, konkurent 60·c/100 → 24 + 60 = 40 + 0,6·c.
  assert.equal(w.cenaBreakEven, 73);
  assert.ok(Math.abs(w.pctRoznica - (-0.2667)) < 0.001);
  assert.equal(w.bezLimitu, false);
  assert.equal(analizaPunktow({ ...baza, mojaCena: 73 }).wygrywam, true);
  assert.equal(analizaPunktow({ ...baza, mojaCena: 74 }).wygrywam, false);
});

test('cena remisu: Twoja cena dużo niższa i lepsza jakość → próg 150, a nie „bez limitu"', () => {
  const baza = { konkurencyjnaCena: 100, wagaCeny: 60, kryteria: GWARANCJA(60, 30) };
  const w = analizaPunktow({ ...baza, mojaCena: 30 });
  assert.equal(w.bezLimitu, false);
  assert.equal(w.cenaBreakEven, 150); // 40 + 6000/c = 20 + 60
  assert.equal(analizaPunktow({ ...baza, mojaCena: 150 }).wygrywam, true); // remis 80 = 80
  const przy200 = analizaPunktow({ ...baza, mojaCena: 200 });
  assert.equal(przy200.wygrywam, false);
  assert.equal(przy200.mojePkt, 70);
  assert.equal(przy200.konkPkt, 80);
});

test('cena remisu: próg nie zależy od Twojej obecnej ceny', () => {
  const baza = { konkurencyjnaCena: 100, wagaCeny: 60, kryteria: GWARANCJA(60, 36) };
  for (const mojaCena of [10, 90, 100, 136, 500]) {
    assert.equal(analizaPunktow({ ...baza, mojaCena }).cenaBreakEven, 136, `mojaCena=${mojaCena}`);
  }
});

test('cena remisu: „bez limitu" tylko gdy przewaga pozacenowa ≥ cała waga ceny', () => {
  // Przewaga dokładnie równa wadze ceny: 40 − 20 = 20 = waga ceny → remis dopiero „w nieskończoności".
  const w = analizaPunktow({
    mojaCena: 100, konkurencyjnaCena: 100, wagaCeny: 20,
    kryteria: [{ nazwa: 'Gwarancja', waga: 40, kierunek: 'max', moje: 60, konkurent: 30 }],
  });
  assert.equal(w.bezLimitu, true);
  assert.equal(w.cenaBreakEven, null);
});

test('cena remisu: strata pozacenowa większa niż cała waga ceny → nie wygrasz żadną ceną', () => {
  // Ty 80·10/60 = 13,33 pkt, konkurent 80 pkt; nawet cena ≈ 0 daje Ci najwyżej 13,33 + 20.
  const w = analizaPunktow({
    mojaCena: 100, konkurencyjnaCena: 100, wagaCeny: 20,
    kryteria: [{ nazwa: 'Gwarancja', waga: 80, kierunek: 'max', moje: 10, konkurent: 60 }],
  });
  assert.equal(w.bezSzans, true);
  assert.equal(w.cenaBreakEven, null);
  assert.equal(w.pctRoznica, null);
  assert.equal(w.bezLimitu, false);
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
