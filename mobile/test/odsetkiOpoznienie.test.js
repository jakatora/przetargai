import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policzOdsetki, rekompensataEUR, walidujOdsetki } from '../src/lib/odsetkiOpoznienie.js';

test('odsetki = kwota × stawka% × dni/365', () => {
  // 100 000 zł, 11,5%/rok, 40 dni → 100000 × 0,115 × 40/365 = 1260,27
  const w = policzOdsetki({ kwota: 100000, terminPlatnosci: '2026-05-01', dataZaplaty: '2026-06-10', stawkaRoczna: 11.5 });
  assert.equal(w.dniOpoznienia, 40);
  assert.equal(w.odsetki, 1260.27);
  assert.equal(w.maDane, true);
});

test('odsetki: połówka grosza w górę mimo float (20 805 zł × 11,75% × 30/365 = 200,925 → 200,93)', () => {
  const w = policzOdsetki({ kwota: '20 805', terminPlatnosci: '2026-01-02', dataZaplaty: '2026-02-01', stawkaRoczna: '11,75' });
  assert.equal(w.dniOpoznienia, 30);
  assert.equal(w.odsetki, 200.93);
});

test('zapłata w terminie lub przed → 0 dni i 0 odsetek', () => {
  const w = policzOdsetki({ kwota: 100000, terminPlatnosci: '2026-05-01', dataZaplaty: '2026-05-01', stawkaRoczna: 11.5 });
  assert.equal(w.dniOpoznienia, 0);
  assert.equal(w.odsetki, 0);
  const przed = policzOdsetki({ kwota: 100000, terminPlatnosci: '2026-05-10', dataZaplaty: '2026-05-01', stawkaRoczna: 11.5 });
  assert.equal(przed.dniOpoznienia, 0);
});

test('rekompensata wg progów należności (art. 10 ust. 1)', () => {
  assert.equal(rekompensataEUR(4999), 40);
  // art. 10 ust. 1 pkt 1: 40 € gdy świadczenie „nie przekracza 5000 zł" — 5000 zł to jeszcze 40 €.
  assert.equal(rekompensataEUR(5000), 40);
  assert.equal(rekompensataEUR('5 000,00'), 40);
  assert.equal(rekompensataEUR(5000.01), 70);
  assert.equal(rekompensataEUR(49999), 70);
  assert.equal(rekompensataEUR(49999.99), 70);
  assert.equal(rekompensataEUR(50000), 100);
  assert.equal(rekompensataEUR(250000), 100);
});

test('rekompensataEUR w wyniku zależna od kwoty; null bez kwoty', () => {
  assert.equal(policzOdsetki({ kwota: 3000, terminPlatnosci: '2026-01-01', dataZaplaty: '2026-02-01', stawkaRoczna: 10 }).rekompensataEUR, 40);
  assert.equal(policzOdsetki({ kwota: 0 }).rekompensataEUR, null);
});

test('polski przecinek w kwocie i stawce', () => {
  const w = policzOdsetki({ kwota: '10 000,00', terminPlatnosci: '2026-01-01', dataZaplaty: '2026-01-31', stawkaRoczna: '12,5' });
  assert.equal(w.dniOpoznienia, 30);
  assert.equal(w.odsetki, 102.74); // 10000 × 0,125 × 30/365 = 102,7397 → 102,74
});

test('niepoprawna data → bladDaty, maDane false', () => {
  const w = policzOdsetki({ kwota: 1000, terminPlatnosci: '2026-13-40', dataZaplaty: '2026-02-01', stawkaRoczna: 10 });
  assert.equal(w.bladDaty, true);
  assert.equal(w.maDane, false);
});

test('bez danych → zera, maDane false', () => {
  const w = policzOdsetki();
  assert.equal(w.maDane, false);
  assert.equal(w.odsetki, 0);
  assert.equal(w.dniOpoznienia, 0);
});

test('walidujOdsetki: poprawne dane → brak błędów', () => {
  const w = walidujOdsetki({ kwota: '100 000,00', stawkaRoczna: '11,5' });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujOdsetki: puste pola → brak błędów (stan pusty, nie błąd)', () => {
  const w = walidujOdsetki({ kwota: '', stawkaRoczna: '   ' });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
  const puste = walidujOdsetki();
  assert.equal(puste.maBledy, false);
  assert.deepEqual(puste.bledy, {});
});

test('walidujOdsetki: kwota nienumeryczna po oczysc → komunikat o liczbie', () => {
  const w = walidujOdsetki({ kwota: ',,' });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.kwota, 'Podaj kwotę jako liczbę, np. 1200,00');
});

test('walidujOdsetki: kwota ujemna → komunikat o wartości ujemnej', () => {
  const w = walidujOdsetki({ kwota: -500 });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.kwota, 'Kwota nie może być ujemna');
});

test('walidujOdsetki: stawka poza zakresem 0–100% → komunikat o stawce', () => {
  const zaDuza = walidujOdsetki({ kwota: '1000', stawkaRoczna: '150' });
  assert.equal(zaDuza.bledy.stawkaRoczna, 'Stawka spoza zakresu 0–100%');
  const ujemna = walidujOdsetki({ kwota: '1000', stawkaRoczna: '-3' });
  assert.equal(ujemna.bledy.stawkaRoczna, 'Stawka spoza zakresu 0–100%');
});

test('walidujOdsetki: stawka nienumeryczna → komunikat o liczbie', () => {
  const w = walidujOdsetki({ stawkaRoczna: ',' });
  assert.equal(w.bledy.stawkaRoczna, 'Podaj procent jako liczbę, np. 10');
});
