import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  punktyKryterium,
  symuluj,
  KIERUNKI,
  walidujKryteria,
  maBladKryterium,
  WAGA_MAX,
} from '../src/lib/symulatorPunktacji.js';

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

// ─── walidacja pól (lista kryteriów jest dynamiczna → błędy per kryterium) ────
// Dotąd „1.200,50" po cichu dawało „— uzupełnij dane", a waga 150 wchodziła do sumy.

test('walidujKryteria: puste pola i pusta lista = brak błędów (stan pusty ekranu)', () => {
  assert.deepEqual(walidujKryteria([{ waga: '', twoja: '', najlepsza: '' }]), { bledy: {}, maBledy: false });
  assert.deepEqual(walidujKryteria([]), { bledy: {}, maBledy: false });
  assert.deepEqual(walidujKryteria(null), { bledy: {}, maBledy: false });
});

test('walidujKryteria: poprawne liczby, także „1 200,50" = brak błędów', () => {
  const w = walidujKryteria([
    { waga: '60', twoja: '1 200,50', najlepsza: '1 000,00' },
    { waga: '40', twoja: '36', najlepsza: '60' },
  ]);
  assert.deepEqual(w, { bledy: {}, maBledy: false });
});

test('walidujKryteria: „1.200,50" = błąd przy konkretnym kryterium i polu (klucz pole_indeks)', () => {
  const { bledy, maBledy } = walidujKryteria([
    { waga: '60', twoja: '1 000', najlepsza: '900' },
    { waga: '40', twoja: '1.200,50', najlepsza: '' },
  ]);
  assert.equal(maBledy, true);
  assert.equal(bledy.twoja_1, 'Podaj liczbę, np. 10');
  assert.equal(bledy.twoja_0, undefined, 'poprawne kryterium bez błędu');
  assert.equal(bledy.najlepsza_1, undefined, 'puste pole bez błędu');
});

test('walidujKryteria: waga spoza zakresu (0 albo ponad maksimum) = błąd', () => {
  assert.equal(WAGA_MAX, 100);
  assert.equal(walidujKryteria([{ waga: '150' }]).bledy.waga_0, 'Wartość nie może przekraczać 100');
  assert.equal(walidujKryteria([{ waga: '0' }]).bledy.waga_0, 'Waga musi być większa od 0');
  assert.equal(walidujKryteria([{ waga: '-5' }]).bledy.waga_0, 'Wartość musi wynosić co najmniej 0');
  assert.equal(walidujKryteria([{ waga: '100' }]).maBledy, false, '100 pkt to jeszcze poprawna waga');
});

test('walidujKryteria: ujemna wartość własna / najlepsza = błąd', () => {
  const { bledy } = walidujKryteria([{ waga: '60', twoja: '-100', najlepsza: '-1' }]);
  assert.equal(bledy.twoja_0, 'Wartość musi wynosić co najmniej 0');
  assert.equal(bledy.najlepsza_0, 'Wartość musi wynosić co najmniej 0');
});

test('maBladKryterium: wskazuje tylko kryterium z błędem (indeks 1 ≠ 11)', () => {
  const lista = Array.from({ length: 12 }, () => ({ waga: '10', twoja: '1', najlepsza: '1' }));
  lista[11] = { waga: '10', twoja: '1.200,50', najlepsza: '1' };
  const { bledy } = walidujKryteria(lista);
  assert.equal(maBladKryterium(bledy, 11), true);
  assert.equal(maBladKryterium(bledy, 1), false);
  assert.equal(maBladKryterium({}, 0), false);
  assert.equal(maBladKryterium(undefined, 0), false);
});
