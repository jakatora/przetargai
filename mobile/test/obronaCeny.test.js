import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SKLADNIKI, analizaObrony, werdyktObrony } from '../src/lib/obronaCeny.js';

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
