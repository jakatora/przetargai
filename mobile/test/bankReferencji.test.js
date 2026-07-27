import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RODZAJE,
  oknoLat,
  dataWaznosciMs,
  statusReferencji,
  etykietaWaznosci,
  sortujReferencje,
  sprawdzWarunek,
} from '../src/lib/bankReferencji.js';

// Kotwica czasu: 15 stycznia 2026 (czas wstrzykiwany — test deterministyczny).
const TERAZ = Date.UTC(2026, 0, 15);

test('oknoLat: roboty 5 lat, dostawy/usługi 3 lata, nieznany → 3 (bezpiecznie krócej)', () => {
  assert.equal(oknoLat('roboty'), 5);
  assert.equal(oknoLat('dostawy'), 3);
  assert.equal(oknoLat('uslugi'), 3);
  assert.equal(oknoLat('cokolwiek'), 3);
  assert.equal(RODZAJE.roboty.lata, 5);
});

test('dataWaznosciMs: zakończenie + okno lat; zła data → null', () => {
  assert.equal(dataWaznosciMs('2024-06-01', 'roboty'), Date.UTC(2029, 5, 1)); // +5
  assert.equal(dataWaznosciMs('2024-06-01', 'dostawy'), Date.UTC(2027, 5, 1)); // +3
  assert.equal(dataWaznosciMs('2026-02-30', 'roboty'), null);
  assert.equal(dataWaznosciMs(undefined, 'roboty'), null);
});

test('statusReferencji: robota sprzed 6 lat już się NIE liczy (wygasła)', () => {
  const s = statusReferencji({ dataZakonczenia: '2020-01-01', rodzaj: 'roboty' }, TERAZ);
  assert.equal(s.status, 'wygasla');
  assert.equal(s.ton, 'danger');
  assert.ok(s.dni < 0);
});

test('statusReferencji: świeża robota jest aktualna', () => {
  const s = statusReferencji({ dataZakonczenia: '2024-01-01', rodzaj: 'roboty' }, TERAZ);
  assert.equal(s.status, 'wazna');
  assert.equal(s.ton, 'sukces');
  assert.ok(s.dni > 180);
});

test('statusReferencji: okno kończy się w ciągu 180 dni → ostrzeżenie (dokładny licznik)', () => {
  // roboty zakończone 2021-06-01 → okno do 2026-06-01; z 2026-01-15 to 137 dni
  const s = statusReferencji({ dataZakonczenia: '2021-06-01', rodzaj: 'roboty' }, TERAZ);
  assert.equal(s.status, 'wygasa');
  assert.equal(s.ton, 'ostrzezenie');
  assert.equal(s.dni, 137);
});

test('statusReferencji: brak daty → nieznana (neutral)', () => {
  const s = statusReferencji({ rodzaj: 'roboty' }, TERAZ);
  assert.equal(s.status, 'nieznana');
  assert.equal(s.ton, 'neutral');
  assert.equal(s.dni, null);
});

test('etykietaWaznosci: ludzkie opisy per status', () => {
  assert.equal(etykietaWaznosci({ status: 'wygasla', dni: -10 }), 'Już się nie liczy (10 dni po oknie)');
  assert.equal(etykietaWaznosci({ status: 'wygasa', dni: 137 }), 'Przestanie się liczyć za 137 dni');
  assert.equal(etykietaWaznosci({ status: 'wygasa', dni: 0 }), 'Przestaje się liczyć dziś');
  assert.equal(etykietaWaznosci({ status: 'wazna', dni: 900 }), 'Doświadczenie aktualne');
  assert.equal(etykietaWaznosci({ status: 'nieznana', dni: null }), 'Uzupełnij datę zakończenia');
});

test('sortujReferencje: wygasa → wazna → nieznana → wygasla; nie mutuje wejścia', () => {
  const wejscie = [
    { id: 'stara', dataZakonczenia: '2020-01-01', rodzaj: 'roboty' },   // wygasla
    { id: 'swieza', dataZakonczenia: '2024-01-01', rodzaj: 'roboty' },  // wazna
    { id: 'brak', rodzaj: 'roboty' },                                    // nieznana
    { id: 'konczy', dataZakonczenia: '2021-06-01', rodzaj: 'roboty' },  // wygasa
  ];
  const kopia = JSON.parse(JSON.stringify(wejscie));
  const out = sortujReferencje(wejscie, TERAZ);
  assert.deepEqual(out.map((r) => r.id), ['konczy', 'swieza', 'brak', 'stara']);
  assert.deepEqual(wejscie, kopia); // wejście nietknięte
  assert.equal(out[0]._ocena.status, 'wygasa');
});

test('sprawdzWarunek: liczy tylko aktualne doświadczenie właściwego rodzaju i wartości', () => {
  const referencje = [
    { dataZakonczenia: '2024-01-01', rodzaj: 'roboty', wartosc: 600000 }, // aktualna, ≥500k → liczy
    { dataZakonczenia: '2024-03-01', rodzaj: 'roboty', wartosc: 300000 }, // za mała wartość → nie
    { dataZakonczenia: '2020-01-01', rodzaj: 'roboty', wartosc: 700000 }, // wygasła → nie
    { dataZakonczenia: '2024-05-01', rodzaj: 'dostawy', wartosc: 900000 }, // zły rodzaj → nie
  ];
  const w = sprawdzWarunek(referencje, { rodzaj: 'roboty', minWartosc: 500000, minLiczba: 2 }, TERAZ);
  assert.equal(w.maja, 1);
  assert.equal(w.potrzeba, 2);
  assert.equal(w.brakuje, 1);
  assert.equal(w.spelnia, false);
});
