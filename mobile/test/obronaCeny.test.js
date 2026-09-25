import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKLADNIKI,
  analizaObrony,
  werdyktObrony,
  walidujObrone,
  ETYKIETA_CENY,
  PODPOWIEDZ_CENY,
  MIN_STAWKA_GODZ_2026,
} from '../src/lib/obronaCeny.js';

// Komplet dowodów dla wszystkich składników.
const WSZYSTKIE_DOWODY = Object.fromEntries(SKLADNIKI.map((s) => [s.klucz, true]));

test('analizaObrony: komplet (suma=cena, stawka ok, dowody) → gotowa/sukces', () => {
  const w = analizaObrony({
    cena: 200000,
    skladniki: { robocizna: 100000, materialy: 60000, sprzet: 20000, posrednie: 12000, zysk: 8000 },
    roboczogodziny: 2500,        // 100000/2500 = 40 zł/h
    minStawkaGodz: 30.5,
    dowody: WSZYSTKIE_DOWODY,
  });
  assert.equal(w.suma, 200000);
  assert.equal(w.zgodna, true);
  assert.equal(w.stawkaGodz, 40);
  assert.equal(w.ponizejMinimum, false);
  assert.deepEqual(w.brakDowodu, []);
  assert.equal(w.gotowa, true);
  assert.equal(w.ton, 'sukces');
});

test('analizaObrony: brak dowodu dla niezerowego składnika → danger, nie gotowa', () => {
  const w = analizaObrony({
    cena: 200000,
    skladniki: { robocizna: 100000, materialy: 60000, sprzet: 20000, posrednie: 12000, zysk: 8000 },
    roboczogodziny: 2500,
    minStawkaGodz: 30.5,
    dowody: { ...WSZYSTKIE_DOWODY, materialy: false }, // brak dowodu na materiały
  });
  assert.deepEqual(w.brakDowodu, ['Materiały']);
  assert.equal(w.gotowa, false);
  assert.equal(w.ton, 'danger');
  assert.ok(w.problemy.some((p) => /dowod/i.test(p.tekst)));
});

test('analizaObrony: stawka pracy poniżej minimum → danger (art. 224 ust. 3)', () => {
  const w = analizaObrony({
    cena: 200000,
    skladniki: { robocizna: 50000, materialy: 110000, sprzet: 20000, posrednie: 12000, zysk: 8000 },
    roboczogodziny: 2500,        // 50000/2500 = 20 zł/h < 30.5
    minStawkaGodz: 30.5,
    dowody: WSZYSTKIE_DOWODY,
  });
  assert.equal(w.stawkaGodz, 20);
  assert.equal(w.ponizejMinimum, true);
  assert.equal(w.ton, 'danger');
  assert.equal(w.gotowa, false);
});

test('analizaObrony: składniki nie sumują się do ceny → ostrzeżenie', () => {
  const w = analizaObrony({
    cena: 200000,
    skladniki: { robocizna: 100000, materialy: 60000, sprzet: 20000, posrednie: 5000, zysk: 5000 }, // suma 190000
    roboczogodziny: 2500,
    minStawkaGodz: 30.5,
    dowody: WSZYSTKIE_DOWODY,
  });
  assert.equal(w.suma, 190000);
  assert.equal(w.roznicaDoCeny, 10000);
  assert.equal(w.zgodna, false);
  assert.equal(w.ton, 'ostrzezenie');
  assert.equal(w.gotowa, false);
});

// ─── cena NETTO i aktualna stawka minimalna (2026-09-25) ─────────────────────
// Składniki (netto) porównywano z polem „Cena oferty (zł)", w które wpisuje się cenę brutto
// jak w formularzu ofertowym → fałszywe „składniki nie sumują się" (różnica = VAT).

test('pole ceny jednoznacznie NETTO: etykieta i podpowiedź „bez VAT — jak składniki"', () => {
  assert.match(ETYKIETA_CENY, /NETTO/);
  assert.match(PODPOWIEDZ_CENY, /bez VAT/i);
  assert.match(PODPOWIEDZ_CENY, /składniki/i);
});

test('komunikat o niezgodnej sumie mówi o cenie NETTO', () => {
  const w = analizaObrony({
    cena: 246000, // ktoś wpisał brutto (200 000 + 23% VAT)
    skladniki: { robocizna: 100000, materialy: 60000, sprzet: 20000, posrednie: 12000, zysk: 8000 },
    dowody: WSZYSTKIE_DOWODY,
  });
  assert.equal(w.zgodna, false);
  const problem = w.problemy.find((p) => /nie sumują/.test(p.tekst));
  assert.match(problem.tekst, /netto/i);
  assert.match(problem.tekst, /bez VAT/i);
});

test('minimalna stawka godzinowa 2026 = 31,40 zł (rozp. RM z 11.09.2025) — domyślna podpowiedź', () => {
  assert.equal(MIN_STAWKA_GODZ_2026, 31.4);
  assert.equal(walidujObrone({ minStawkaGodz: '31,40' }).maBledy, false);
});

test('analizaObrony: bez roboczogodzin nie liczymy stawki (nie blokuje)', () => {
  const w = analizaObrony({
    cena: 100000,
    skladniki: { robocizna: 50000, materialy: 40000, sprzet: 0, posrednie: 5000, zysk: 5000 },
    dowody: { robocizna: true, materialy: true, posrednie: true, zysk: true },
  });
  assert.equal(w.stawkaGodz, null);
  assert.equal(w.ponizejMinimum, false);
  // sprzet=0 → nie wymaga dowodu; reszta ma dowód → gotowa
  assert.equal(w.brakDowodu.length, 0);
  assert.equal(w.gotowa, true);
});

test('werdyktObrony: komunikat zależny od stanu', () => {
  assert.match(werdyktObrony({ gotowa: true }), /kompletne/i);
  assert.match(werdyktObrony({ gotowa: false, ton: 'danger' }), /odrzuceni/i);
});

test('walidujObrone: puste pola → brak błędów (stan pusty, nie błąd)', () => {
  const w = walidujObrone({ cena: '', roboczogodziny: '  ', minStawkaGodz: '', skladniki: { robocizna: '' } });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujObrone: poprawne liczby (też „200 000,50" i „30.50") → brak błędów', () => {
  const w = walidujObrone({
    cena: '200 000,50', roboczogodziny: '2500', minStawkaGodz: '30.50',
    skladniki: { robocizna: '100 000', materialy: '60000,50', sprzet: '0', posrednie: '12000', zysk: '8000' },
  });
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});

test('walidujObrone: „1.200,50" w cenie i składniku → komunikat zamiast cichego 0', () => {
  const w = walidujObrone({ cena: '1.200,50', skladniki: { materialy: '1.200,50' } });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.cena, 'Podaj kwotę jako liczbę, np. 1200,00');
  assert.equal(w.bledy.materialy, 'Podaj kwotę jako liczbę, np. 1200,00');
});

test('walidujObrone: ujemny składnik i ujemne roboczogodziny → komunikat', () => {
  const w = walidujObrone({ cena: '200000', roboczogodziny: '-10', skladniki: { zysk: '-500' } });
  assert.equal(w.bledy.zysk, 'Kwota nie może być ujemna');
  assert.equal(w.bledy.roboczogodziny, 'Wartość musi wynosić co najmniej 0');
});

test('walidujObrone: min. stawka ponad 1000 zł/h (np. „3050" zamiast „30,50") → komunikat', () => {
  const w = walidujObrone({ minStawkaGodz: '3050' });
  assert.equal(w.maBledy, true);
  assert.equal(w.bledy.minStawkaGodz, 'Wartość nie może przekraczać 1000');
  assert.equal(walidujObrone({ minStawkaGodz: '-30' }).bledy.minStawkaGodz, 'Kwota nie może być ujemna');
});

test('walidujObrone: bez argumentów nie wywraca funkcji', () => {
  const w = walidujObrone();
  assert.equal(w.maBledy, false);
  assert.deepEqual(w.bledy, {});
});
