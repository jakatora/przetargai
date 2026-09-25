import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocenStart, CZYNNIKI, WERDYKTY, CZYNNIKI_KRYTYCZNE } from '../src/lib/kartaDecyzji.js';

const najlepsze = { dopasowanie: 'wysokie', warunki: 'tak', konkurencyjnosc: 'tak', plynnosc: 'tak', wadium: 'tak', termin: 'tak', marza: 'tak', umowa: 'tak' };

test('same najlepsze odpowiedzi → 100% i STARTUJ', () => {
  const w = ocenStart(najlepsze);
  assert.equal(w.procent, 100);
  assert.equal(w.werdykt, 'start');
  assert.equal(w.zBlokada, false);
  assert.equal(w.odpowiedziano, CZYNNIKI.length);
  assert.ok(WERDYKTY[w.werdykt]);
});

test('BLOKADA (strata) wywraca werdykt na ODPUŚĆ mimo wysokiego wyniku', () => {
  const w = ocenStart({ ...najlepsze, marza: 'strata' });
  assert.equal(w.werdykt, 'odpusc');
  assert.equal(w.zBlokada, true);
  assert.equal(w.blokady.length, 1);
  assert.match(w.blokady[0].tekst, /dokładasz/);
});

test('kilka blokad naraz — wszystkie zebrane', () => {
  const w = ocenStart({ ...najlepsze, plynnosc: 'nie', wadium: 'nie' });
  assert.equal(w.werdykt, 'odpusc');
  assert.equal(w.blokady.length, 2);
});

test('same średnie odpowiedzi → ~54% i ROZWAŻ (bez blokady)', () => {
  const w = ocenStart({
    dopasowanie: 'srednie', warunki: 'czesc', konkurencyjnosc: 'srednio', plynnosc: 'napiete',
    wadium: 'tak', termin: 'ryzyko', marza: 'cienko', umowa: 'ryzyko',
  });
  assert.equal(w.procent, 54);
  assert.equal(w.werdykt, 'rozwaz');
  assert.equal(w.zBlokada, false);
});

test('niski wynik BEZ blokady → ODPUŚĆ', () => {
  const w = ocenStart({
    dopasowanie: 'niskie', warunki: 'czesc', konkurencyjnosc: 'nie', plynnosc: 'napiete',
    wadium: 'tak', termin: 'ryzyko', marza: 'cienko', umowa: 'nie',
  });
  assert.equal(w.procent, 40);
  assert.equal(w.werdykt, 'odpusc');
  assert.equal(w.zBlokada, false);
});

test('częściowe odpowiedzi liczą się tylko z odpowiedzianych', () => {
  const w = ocenStart({ dopasowanie: 'wysokie', marza: 'tak' });
  assert.equal(w.odpowiedziano, 2);
  assert.equal(w.procent, 100);
});

test('brak odpowiedzi → 0%, nic nie wywraca', () => {
  const w = ocenStart({});
  assert.equal(w.odpowiedziano, 0);
  assert.equal(w.procent, 0);
  assert.equal(w.zBlokada, false);
  assert.equal(ocenStart(undefined).procent, 0);
});

// ─── czynniki krytyczne (2026-09-25) ─────────────────────────────────────────
// Dotąd ocenStart({dopasowanie:'wysokie'}) dawało 100% i STARTUJ, choć nikt nie odpowiedział
// na pytania, które mogą same przesądzić o ODPUŚĆ (warunki, płynność, wadium, termin, marża).

test('CZYNNIKI_KRYTYCZNE = czynniki z odpowiedzią blokującą', () => {
  assert.deepEqual(CZYNNIKI_KRYTYCZNE, ['warunki', 'plynnosc', 'wadium', 'termin', 'marza']);
  for (const c of CZYNNIKI) {
    assert.equal(CZYNNIKI_KRYTYCZNE.includes(c.klucz), c.opcje.some((o) => o.blokada), c.klucz);
  }
});

test('samo „dopasowanie wysokie" → UZUPEŁNIJ z listą brakujących krytycznych, nie STARTUJ', () => {
  const w = ocenStart({ dopasowanie: 'wysokie' });
  assert.equal(w.werdykt, 'uzupelnij');
  assert.equal(w.procent, 100, 'procent z odpowiedzianych zostaje (informacyjnie)');
  assert.deepEqual(w.brakujaceKrytyczne.map((b) => b.klucz), ['warunki', 'plynnosc', 'wadium', 'termin', 'marza']);
  assert.match(w.brakujaceKrytyczne[0].pytanie, /warunki udziału/);
  assert.ok(WERDYKTY.uzupelnij);
});

test('częściowe odpowiedzi bez kompletu krytycznych → UZUPEŁNIJ; brak odpowiedzi też', () => {
  assert.equal(ocenStart({ dopasowanie: 'wysokie', marza: 'tak' }).werdykt, 'uzupelnij');
  assert.equal(ocenStart({ dopasowanie: 'wysokie', marza: 'tak' }).brakujaceKrytyczne.length, 4);
  assert.equal(ocenStart({}).werdykt, 'uzupelnij');
  assert.equal(ocenStart(undefined).werdykt, 'uzupelnij');
});

test('komplet krytycznych (bez pozostałych) → werdykt liczony normalnie', () => {
  const w = ocenStart({ warunki: 'tak', plynnosc: 'tak', wadium: 'tak', termin: 'tak', marza: 'tak' });
  assert.equal(w.werdykt, 'start');
  assert.deepEqual(w.brakujaceKrytyczne, []);
});

test('blokada przesądza o ODPUŚĆ nawet przy brakach w krytycznych', () => {
  const w = ocenStart({ dopasowanie: 'wysokie', wadium: 'nie' });
  assert.equal(w.werdykt, 'odpusc');
  assert.equal(w.zBlokada, true);
  assert.equal(w.brakujaceKrytyczne.length, 4, 'lista braków nadal dostępna');
});

test('same najlepsze odpowiedzi → brak brakujących krytycznych', () => {
  assert.deepEqual(ocenStart(najlepsze).brakujaceKrytyczne, []);
});
