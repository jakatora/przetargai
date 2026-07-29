import { test } from 'node:test';
import assert from 'node:assert/strict';
import { punktyKryterium, symuluj, KIERUNKI } from '../src/lib/symulatorPunktacji.js';

test('kryterium ceny (min): pkt = waga × najniższa/twoja', () => {
  assert.equal(punktyKryterium({ waga: 60, twoja: 100, najlepsza: 80, kierunek: 'min' }), 48);
  // Twoja jest najniższa → maksimum wagi.
  assert.equal(punktyKryterium({ waga: 60, twoja: 80, najlepsza: 80, kierunek: 'min' }), 60);
});

test('kryterium „więcej lepiej" (max): pkt = waga × twoja/najlepsza', () => {
  assert.equal(punktyKryterium({ waga: 40, twoja: 48, najlepsza: 60, kierunek: 'max' }), 32);
  assert.equal(punktyKryterium({ waga: 40, twoja: 60, najlepsza: 60, kierunek: 'max' }), 40);
});

test('wynik nigdy nie przekracza wagi (przycięcie przy niespójnych danych)', () => {
  // min: twoja lepsza (niższa) niż „najlepsza" → stosunek > 1 → przycięte do wagi.
  assert.equal(punktyKryterium({ waga: 60, twoja: 70, najlepsza: 80, kierunek: 'min' }), 60);
  assert.equal(punktyKryterium({ waga: 40, twoja: 90, najlepsza: 60, kierunek: 'max' }), 40);
});

test('niekompletne / niepoprawne kryterium → null', () => {
  assert.equal(punktyKryterium({ waga: 60, twoja: '', najlepsza: 80, kierunek: 'min' }), null);
  assert.equal(punktyKryterium({ waga: 0, twoja: 100, najlepsza: 80, kierunek: 'min' }), null);
  assert.equal(punktyKryterium({ waga: 60, twoja: 'abc', najlepsza: 80 }), null);
  assert.equal(punktyKryterium(), null);
});

test('symuluj: sumuje punkty i wagi tylko z kompletnych kryteriów', () => {
  const wynik = symuluj([
    { nazwa: 'Cena', waga: 60, twoja: 100, najlepsza: 80, kierunek: 'min' },   // 48
    { nazwa: 'Gwarancja', waga: 40, twoja: 48, najlepsza: 60, kierunek: 'max' }, // 32
    { nazwa: 'Puste', waga: 20, twoja: '', najlepsza: '', kierunek: 'max' },     // pominięte
  ]);
  assert.equal(wynik.sumaPkt, 80);
  assert.equal(wynik.sumaWag, 100, 'puste kryterium nie wchodzi do sumy wag');
  assert.equal(wynik.procent, 80);
  assert.equal(wynik.kompletnych, 2);
});

test('polski przecinek w danych parsuje się poprawnie', () => {
  const p = punktyKryterium({ waga: '50', twoja: '1 250,00', najlepsza: '1 000,00', kierunek: 'min' });
  assert.equal(p, 40); // 50 × 1000/1250
});

test('pusta lista → zerowy wynik, bez wywrotki', () => {
  const w = symuluj([]);
  assert.equal(w.sumaPkt, 0);
  assert.equal(w.procent, 0);
  assert.equal(w.kompletnych, 0);
  assert.equal(KIERUNKI.length, 2);
});
