import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsujPozycjeFormularza, naWierszeSprawdzarki } from '../src/lib/parserPozycji.js';

/*
 * „Wklej pozycje z SWZ" — zamiast przepisywać formularz cenowy pozycja po pozycji,
 * wykonawca wkleja tabelę (z PDF/Worda/Excela) i dostaje wiersze gotowe do wyceny.
 * Parser jest heurystyczny i DEFENSYWNY: lepiej pominąć śmieciowy wiersz niż
 * wstawić „NaN" do formularza, który trafi do zamawiającego.
 */

test('tabela rozdzielana tabulatorami z nagłówkiem i wierszem „Razem": lp, nazwa, jm, ilość', () => {
  const t = 'Lp.\tNazwa\tJ.m.\tIlość\n1\tDemontaż pokrycia dachu\tm2\t450\n2\tŁaty i kontrłaty\tm2\t450,5\n3\tDachówka ceramiczna\tm2\t1 200\nRazem\t\t\t';
  const p = parsujPozycjeFormularza(t);
  assert.deepEqual(p.map((x) => [x.lp, x.nazwa, x.jm, x.ilosc]), [
    ['1', 'Demontaż pokrycia dachu', 'm2', '450'],
    ['2', 'Łaty i kontrłaty', 'm2', '450,5'],
    ['3', 'Dachówka ceramiczna', 'm2', '1 200'],
  ]);
});

test('tabela z kreskami | i kolumnami cena/wartość: cena jedn. i wartość trafiają do wiersza', () => {
  const t = '| 1 | Rynny PVC | mb | 120 | 45,00 | 5 400,00 |\n| 2. | Rury spustowe | mb | 60 | 52,50 | 3 150,00 |';
  const p = parsujPozycjeFormularza(t);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { lp: '1', nazwa: 'Rynny PVC', jm: 'mb', ilosc: '120', cenaJedn: '45,00', wartoscPodana: '5 400,00' });
  assert.equal(p[1].lp, '2');
  assert.equal(p[1].cenaJedn, '52,50');
});

test('tekst z PDF bez separatorów: „1. Nazwa … m2 450" — nazwa do jednostki, ilość na końcu', () => {
  const t = '1. Rozbiórka komina ponad dachem szt. 2\n2. Obróbki blacharskie z blachy tytan-cynk mb 84,6\n3 Wywóz gruzu m3 12';
  const p = parsujPozycjeFormularza(t);
  assert.deepEqual(p.map((x) => [x.nazwa, x.jm, x.ilosc]), [
    ['Rozbiórka komina ponad dachem', 'szt.', '2'],
    ['Obróbki blacharskie z blachy tytan-cynk', 'mb', '84,6'],
    ['Wywóz gruzu', 'm3', '12'],
  ]);
});

test('wiersz bez liczby ilości jest pomijany; puste linie i nagłówki też; nic nie rzuca', () => {
  const p = parsujPozycjeFormularza('Formularz cenowy\n\nLp | Opis | jm | ilość\n1 | Pozycja bez ilości | kpl |\n2 | Prawidłowa | kpl | 1\nSUMA | | |');
  assert.deepEqual(p.map((x) => x.nazwa), ['Prawidłowa']);
  assert.deepEqual(parsujPozycjeFormularza(''), []);
  assert.deepEqual(parsujPozycjeFormularza(null), []);
});

test('naWierszeSprawdzarki: wiersze gotowe dla ekranu (id, VAT domyślny, puste cena/wartość gdy brak)', () => {
  const w = naWierszeSprawdzarki([{ lp: '1', nazwa: 'A', jm: 'm2', ilosc: '10' }, { lp: '2', nazwa: 'B', jm: 'szt', ilosc: '2', cenaJedn: '5,00', wartoscPodana: '10,00' }], { vat: '8', odId: 7 });
  assert.deepEqual(w, [
    { id: 'w7', nazwa: 'A (m2)', ilosc: '10', cenaJedn: '', vat: '8', wartoscPodana: '' },
    { id: 'w8', nazwa: 'B (szt)', ilosc: '2', cenaJedn: '5,00', vat: '8', wartoscPodana: '10,00' },
  ]);
});
