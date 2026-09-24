import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Wyjaśnienie dopasowania na ekranie (P1-4) — czysta warstwa prezentacji.
 *
 * Backend liczy sygnały; ta warstwa decyduje, co z nich pokazać na KARCIE (mało
 * miejsca, ma przyciągnąć wzrok), a co w SZCZEGÓŁACH (komplet z podpowiedziami),
 * oraz jakim tonem. Ton jest nazwą semantyczną — kolory należą do motywu.
 */

const W = await import('../src/lib/wyjasnienieDopasowania.js');

const sygnal = (typ, sila, nad = {}) => ({
  typ,
  sila,
  etykieta: { pl: typ, en: typ },
  szczegol: { pl: `szczegół ${typ}`, en: `detail ${typ}` },
  wartosci: [],
  podpowiedz: null,
  ...nad,
});

const wyjasnienie = (sygnaly) => ({
  zrodlo: 'heurystyka',
  sygnaly,
  podsumowanie: { pl: 'Dopasowane przez: …', en: 'Matched by: …' },
});

test('ton sygnału odpowiada jego sile', () => {
  assert.equal(W.tonSygnalu('mocny'), 'ok');
  assert.equal(W.tonSygnalu('czesciowy'), 'uwaga');
  assert.equal(W.tonSygnalu('brak'), 'neutralny');
  assert.equal(W.tonSygnalu('informacja'), 'neutralny');
  assert.equal(W.tonSygnalu(undefined), 'neutralny');
});

test('KRYTYCZNE: skrót na kartę pokazuje tylko sygnały, które ZADZIAŁAŁY', () => {
  const skrot = W.skrotWyjasnienia(wyjasnienie([
    sygnal('cpv', 'mocny', { wartosci: ['45233000', '45233222'] }),
    sygnal('slowa', 'czesciowy', { wartosci: ['droga'] }),
    sygnal('region', 'informacja'),
    sygnal('wartosc', 'brak'),
  ]));
  assert.deepEqual(skrot.map((s) => s.typ), ['cpv', 'slowa']);
  assert.match(skrot[0].tekst.pl, /45233222/);
  assert.match(skrot[1].tekst.pl, /droga/);
});

test('skrót na kartę jest KRÓTKI — najwyżej dwa znaczniki', () => {
  const skrot = W.skrotWyjasnienia(wyjasnienie([
    sygnal('cpv', 'mocny', { wartosci: ['45233000', '45233222'] }),
    sygnal('slowa', 'mocny', { wartosci: ['droga', 'chodnik'] }),
    sygnal('region', 'mocny', { wartosci: ['14'] }),
    sygnal('wartosc', 'mocny'),
  ]));
  assert.ok(skrot.length <= 2, `karta ma miejsce na 2 znaczniki, dostała ${skrot.length}`);
});

test('skrót na kartę znika, gdy nic nie zadziałało — pusty rząd to szum', () => {
  assert.deepEqual(W.skrotWyjasnienia(wyjasnienie([
    sygnal('cpv', 'brak'), sygnal('slowa', 'brak'),
  ])), []);
  assert.deepEqual(W.skrotWyjasnienia(null), []);
});

test('skrót słów mówi ILE słów trafiło, a nie wypisuje wszystkich', () => {
  const skrot = W.skrotWyjasnienia(wyjasnienie([
    sygnal('slowa', 'mocny', { wartosci: ['droga', 'chodnik', 'krawężnik', 'nawierzchnia'] }),
  ]));
  assert.match(skrot[0].tekst.pl, /4/);
});

test('wiersze szczegółów zachowują komplet czterech sygnałów', () => {
  const wiersze = W.wierszeWyjasnienia(wyjasnienie([
    sygnal('cpv', 'mocny'), sygnal('slowa', 'brak'),
    sygnal('region', 'informacja'), sygnal('wartosc', 'mocny'),
  ]));
  assert.equal(wiersze.length, 4);
  assert.deepEqual(wiersze.map((w) => w.ton), ['ok', 'neutralny', 'neutralny', 'ok']);
});

test('KRYTYCZNE: podpowiedź z sygnału trafia do wiersza — to jest ta akcja do wykonania', () => {
  const wiersze = W.wierszeWyjasnienia(wyjasnienie([
    sygnal('cpv', 'brak', { podpowiedz: { pl: 'Dodaj kody CPV', en: 'Add CPV codes' } }),
  ]));
  assert.equal(wiersze[0].podpowiedz.pl, 'Dodaj kody CPV');
});

test('znak sygnału odróżnia trafienie od informacji, bez polegania na kolorze', () => {
  assert.notEqual(W.znakSygnalu('mocny'), W.znakSygnalu('brak'));
  assert.ok(W.znakSygnalu('informacja').length <= 2, 'to znacznik, nie zdanie');
});

test('etykieta dostępności opisuje sygnał słowami, nie symbolem', () => {
  const opis = W.opisDlaCzytnika(sygnal('cpv', 'mocny', { etykieta: { pl: 'Kody CPV', en: 'CPV codes' } }), 'pl');
  assert.match(opis, /Kody CPV/);
  assert.match(opis, /mocn/i);
  assert.doesNotMatch(opis, /[✓✗]/);
});

test('połamane wejście nie wywraca ekranu', () => {
  assert.deepEqual(W.wierszeWyjasnienia(null), []);
  assert.deepEqual(W.wierszeWyjasnienia({ sygnaly: 'nie tablica' }), []);
});
