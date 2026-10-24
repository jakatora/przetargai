import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propozycjeKarty, zastosujPropozycje } from '../src/lib/propozycjeKarty.js';
import { zbudujSygnal } from '../src/lib/sygnaly.js';

const TERAZ = '2026-10-21T10:00:00.000Z';
const odrz = (tytul, przyczyna, extra = {}) => zbudujSygnal({ typ: 'odrzucenie', tenderId: tytul, tytul, przyczyna, teraz: TERAZ, ...extra });
const zap = (tytul, extra = {}) => zbudujSygnal({ typ: 'zapis', tenderId: tytul, tytul, teraz: TERAZ, ...extra });

test('branża: ≥3 odrzucenia z tym samym słowem → propozycja wykluczenia', () => {
  const user = { keywords: ['dach'], pracownik_sygnaly: [
    odrz('Odśnieżanie dróg gminnych', 'branza'), odrz('Zimowe odśnieżanie chodników', 'branza'),
    odrz('Odśnieżanie placów', 'branza'), zap('Remont dachu'),
  ] };
  const [p] = propozycjeKarty(user, TERAZ);
  assert.equal(p.pole, 'wykluczenia');
  assert.equal(p.akcja, 'zmien');
  assert.match(p.nowa_wartosc, /^odśnieżanie$/);
  assert.equal(p.dowody.length, 3);
  assert.ok(p.klucz && p.klucz.length === 12);
});

test('branża: słowo z zapisanych albo ogólne („dostawa”) nie jest proponowane', () => {
  const user = { keywords: ['dach'], pracownik_sygnaly: [
    odrz('Dostawa dachówki', 'branza'), odrz('Dostawa papy na dach', 'branza'), odrz('Dostawa rynien', 'branza'),
  ] };
  assert.deepEqual(propozycjeKarty(user, TERAZ), []);
});

test('mniej niż 3 odrzucenia albo starsze niż 30 dni → brak propozycji', () => {
  const stare = (t) => odrz(t, 'branza', { teraz: '2026-09-01T10:00:00.000Z' });
  assert.deepEqual(propozycjeKarty({ pracownik_sygnaly: [odrz('Odśnieżanie A', 'branza'), odrz('Odśnieżanie B', 'branza')] }, TERAZ), []);
  assert.deepEqual(propozycjeKarty({ pracownik_sygnaly: [stare('Odśnieżanie A'), stare('Odśnieżanie B'), stare('Odśnieżanie C')] }, TERAZ), []);
});

test('teren: ≥3 odrzucenia → teren = województwa zapisanych (gdy znam ≥2)', () => {
  const user = { pracownik_sygnaly: [
    odrz('A', 'teren'), odrz('B', 'teren'), odrz('C', 'teren'),
    zap('Z1', { wojewodztwo: 'podkarpackie' }), zap('Z2', { wojewodztwo: '12' }),
  ] };
  const [p] = propozycjeKarty(user, TERAZ);
  assert.deepEqual([p.pole, p.akcja, p.nowa_wartosc], ['regiony', 'zmien', ['12', '18']]);
});

test('teren bez wiedzy o zapisanych → otwórz kreator, krok 3', () => {
  const [p] = propozycjeKarty({ pracownik_sygnaly: [odrz('A', 'teren'), odrz('B', 'teren'), odrz('C', 'teren')] }, TERAZ);
  assert.deepEqual([p.pole, p.akcja, p.krok], ['regiony', 'otworz_kreator', 3]);
});

test('za duże: „do” = najmniejsza odrzucona kwota zaokrąglona w dół do 2 cyfr znaczących', () => {
  const user = { wartosc_max: null, pracownik_sygnaly: [
    odrz('A', 'za_duze', { wartosc: 1_534_000 }), odrz('B', 'za_duze', { wartosc: 2_000_000 }), odrz('C', 'za_duze', { wartosc: 3_100_000 }),
  ] };
  const [p] = propozycjeKarty(user, TERAZ);
  assert.deepEqual([p.pole, p.nowa_wartosc], ['wartosc_max', 1_500_000]);
});

test('za małe: „od” = największa odrzucona kwota w górę; termin: maks dni + 1', () => {
  const user = { pracownik_sygnaly: [
    odrz('A', 'za_male', { wartosc: 48_300 }), odrz('B', 'za_male', { wartosc: 20_000 }), odrz('C', 'za_male', { wartosc: 9_000 }),
    odrz('D', 'termin', { termin: '2026-10-27T10:00:00.000Z' }), odrz('E', 'termin', { termin: '2026-10-29T10:00:00.000Z' }),
    odrz('F', 'termin', { termin: '2026-10-25T10:00:00.000Z' }),
  ] };
  const p = propozycjeKarty(user, TERAZ);
  assert.deepEqual(p.find((x) => x.pole === 'wartosc_min').nowa_wartosc, 49_000);
  assert.deepEqual(p.find((x) => x.pole === 'min_dni_oferta').nowa_wartosc, 9);
});

test('warunki przy pustej części formalnej → kreator krok 5', () => {
  const [p] = propozycjeKarty({ pracownik_sygnaly: [odrz('A', 'warunki'), odrz('B', 'warunki'), odrz('C', 'warunki')] }, TERAZ);
  assert.deepEqual([p.pole, p.akcja, p.krok], ['formalne', 'otworz_kreator', 5]);
});

test('„nie teraz” ukrywa propozycję do daty odłożenia', () => {
  const user = { pracownik_sygnaly: [odrz('A', 'teren'), odrz('B', 'teren'), odrz('C', 'teren')] };
  const [p] = propozycjeKarty(user, TERAZ);
  user.pracownik_odlozone = [{ klucz: p.klucz, do: '2026-11-20T10:00:00.000Z' }];
  assert.deepEqual(propozycjeKarty(user, TERAZ), []);
  assert.equal(propozycjeKarty(user, '2026-11-21T10:00:00.000Z').length, 0, 'sygnały też wygasły (okno 30 dni)');
});

test('zastosujPropozycje: dopisuje wykluczenie, nie ruszając reszty karty', () => {
  const user = { company_name: 'X', keywords: ['dach'], cpv_codes: [], regiony: ['18'], wartosc_max: 5,
    karta: { opis: 'o', wykluczenia: ['drogi'], wartosc_min: 1, min_dni_oferta: 6 } };
  const z = zastosujPropozycje(user, { pole: 'wykluczenia', nowa_wartosc: 'odśnieżanie' });
  assert.deepEqual(z.karta.wykluczenia, ['drogi', 'odśnieżanie']);
  assert.equal(z.karta.min_dni_oferta, 6);
  assert.deepEqual(z.regiony, ['18']);
  assert.equal(zastosujPropozycje(user, { pole: 'wartosc_max', nowa_wartosc: 7 }).wartoscMax, 7);
  assert.throws(() => zastosujPropozycje(user, { pole: 'formalne', nowa_wartosc: null }));
});
