import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kryteriaBlizniaka, tytulBezZnaku } from '../src/lib/blizniakKryteriow.js';

/*
 * Bliźniak z kryteriami (2026-11-01): kopia postępowania z platformazakupowa.pl bez kryteriów bierze je
 * od tego samego postępowania w BZP/TED (ten sam termin, tytuł bez znaku sprawy). Tytuły z produkcji.
 */
const KRYT = [{ nazwa: 'Cena', waga: 60, udzial: 60, rodzaj: 'cena' }, { nazwa: 'Okres gwarancji', waga: 40, udzial: 40, rodzaj: 'gwarancja' }];

test('znak sprawy na początku tytułu nie przeszkadza w porównaniu', () => {
  assert.equal(tytulBezZnaku('2026/BZP 00494036/01 Wykonywanie w 2027 roku remontów bieżących'), 'Wykonywanie w 2027 roku remontów bieżących');
  assert.equal(tytulBezZnaku('ZP-2380/61/26/JW Wykonanie robót budowlanych'), 'Wykonanie robót budowlanych');
  assert.equal(tytulBezZnaku('Remont dachu'), 'Remont dachu');
});

test('bliźniak z BZP: kryteria, kryterium_oceny i ślad skąd; inne postępowanie z tym samym terminem — nie', () => {
  const pz = { title: 'MCK-3/RB/2026 Roboty budowlane polegające na wykonaniu prac remontowych w budynku Miejskiego Centrum Kultury' };
  const pola = kryteriaBlizniaka(pz, [
    { id: 'inny', source: 'bzp', title: 'Najem ładowarki teleskopowej przez okres 12 miesięcy', kryteria: [{ nazwa: 'Cena', waga: 100, udzial: 100, rodzaj: 'cena' }] },
    { id: '2026~BZP_00500001~01', source: 'bzp', title: 'Roboty budowlane polegające na wykonaniu prac remontowych w budynku Miejskiego Centrum Kultury', kryteria: KRYT, kryteria_sposob: 'procentowo' },
  ]);
  assert.deepEqual([pola.kryteria_z, pola.kryterium_oceny, pola.kryteria_sposob, pola.kryteria.length], ['2026~BZP_00500001~01', 'cena_i_jakosc', 'procentowo', 2]);
  assert.deepEqual(kryteriaBlizniaka(pz, [{ id: 'x', source: 'bzp', title: 'Wymiana wykładziny w budynku Sądu Okręgowego', kryteria: KRYT }]), {});
  assert.deepEqual(kryteriaBlizniaka(pz, [{ id: 'y', source: 'platformazakupowa', title: pz.title, kryteria: KRYT }]), {}, 'tylko BZP/TED');
  assert.deepEqual(kryteriaBlizniaka(pz, [{ id: 'z', source: 'bzp', title: pz.title, kryteria: null }]), {}, 'bliźniak bez listy nic nie daje');
});
