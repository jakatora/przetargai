import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skrotKartyFirmy, wypelnienieKarty } from '../src/lib/skrotKarty.js';

test('pełna karta: opis, wykluczenia, nazwy województw, widełki kwot; każdy wiersz zna krok kreatora', () => {
  const w = skrotKartyFirmy({
    opis: 'Termomodernizacje, dachy i elewacje budynków publicznych',
    wykluczenia: ['drogi', 'mosty', 'dostawy', 'usługi sprzątania', 'IT'],
    regiony: ['18', '12'], wartosc_min: 50000, wartosc_max: 5000000,
  });
  assert.deepEqual(w.map((x) => [x.klucz, x.wartosc, x.krok]), [
    ['zakres', 'Termomodernizacje, dachy i elewacje budynków publicznych', 1],
    ['wykluczenia', 'drogi, mosty, dostawy, usługi sprzątania i 1 więcej', 2],
    ['teren', 'Podkarpackie, Małopolskie', 3],
    ['skala', '50 tys. zł – 5 mln zł', 4],
  ]);
  assert.equal(wypelnienieKarty(w), 4);
});

test('pusta karta: wszystko do uzupełnienia; bez opisu — słowa kluczowe; sama górna kwota', () => {
  const pusta = skrotKartyFirmy(null);
  assert.deepEqual(pusta.map((x) => x.wartosc), [null, null, null, null]);
  assert.equal(wypelnienieKarty(pusta), 0);
  const w = skrotKartyFirmy({ keywords: ['dach', 'elewacja'], wartosc_max: 1500000, regiony: Array.from({ length: 16 }, (_, i) => String(2 + i * 2).padStart(2, '0')) });
  assert.equal(w[0].wartosc, 'dach, elewacja');
  assert.equal(w[3].wartosc, 'do 1,5 mln zł');
  assert.equal(w[2].wartosc, 'cała Polska');
});
