import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseStreszczenie, buildSummaryPrompt, dniDoTerminu } from '../src/lib/streszczenie.js';

/*
 * Wyjaśnienie AI ogłoszenia (życzenie usera 2026-07-11 „udoskonal aplikacje";
 * luka #1 z analizy konkurencji [[reference_przetargai_konkurencja]]).
 * Ekspert od zamówień publicznych tłumaczy JDG żargonowe ogłoszenie na ludzki
 * język: czego dotyczy, jakie dokumenty typowo trzeba, na co uważać, czy pasuje
 * do małej firmy. Czysta logika — parsowanie odpowiedzi modelu i budowa promptu.
 */

// ---------------- parseStreszczenie ----------------

const DOBRY = JSON.stringify({
  czego_dotyczy: 'Gmina chce wyremontować dach szkoły podstawowej.',
  dokumenty: ['Formularz oferty', 'Wpis do CEIDG', 'Referencje z podobnych robót'],
  na_co_uwaga: 'Krótki termin składania ofert — zostały 3 dni.',
  ocena: 'Zamówienie w sam raz dla małej firmy budowlanej.',
});

test('parsuje poprawny JSON i zwraca komplet pól', () => {
  const s = parseStreszczenie(DOBRY);
  assert.equal(s.czego_dotyczy, 'Gmina chce wyremontować dach szkoły podstawowej.');
  assert.deepEqual(s.dokumenty, ['Formularz oferty', 'Wpis do CEIDG', 'Referencje z podobnych robót']);
  assert.match(s.na_co_uwaga, /3 dni/);
  assert.match(s.ocena, /małej firmy/);
});

test('wyłuskuje JSON otoczony prozą modelu', () => {
  const s = parseStreszczenie(`Oto wyjaśnienie:\n${DOBRY}\nMam nadzieję, że pomogłem.`);
  assert.ok(s);
  assert.match(s.czego_dotyczy, /dach szkoły/);
});

test('brak JSON-a albo pusty temat = null (wołający pokazuje błąd)', () => {
  assert.equal(parseStreszczenie('Nie wiem, przepraszam.'), null);
  assert.equal(parseStreszczenie(''), null);
  assert.equal(parseStreszczenie(JSON.stringify({ dokumenty: ['x'] })), null, 'bez czego_dotyczy nie ma streszczenia');
});

test('dokumenty: odsiewa puste, przycina nadmiar do 8, każdy do rozsądnej długości', () => {
  const s = parseStreszczenie(JSON.stringify({
    czego_dotyczy: 'Coś tam.',
    dokumenty: ['A', '', '   ', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  }));
  assert.equal(s.dokumenty.length, 8, 'maks 8 pozycji');
  assert.ok(!s.dokumenty.includes(''), 'bez pustych');
});

test('dokumenty nie-tablica albo brak = pusta lista (nie wywala się)', () => {
  const s = parseStreszczenie(JSON.stringify({ czego_dotyczy: 'Coś.', dokumenty: 'nie tablica' }));
  assert.deepEqual(s.dokumenty, []);
  const s2 = parseStreszczenie(JSON.stringify({ czego_dotyczy: 'Coś.' }));
  assert.deepEqual(s2.dokumenty, []);
});

test('tnie ufa długościom pól tekstowych (obcina)', () => {
  const dlugi = 'x'.repeat(5000);
  const s = parseStreszczenie(JSON.stringify({ czego_dotyczy: dlugi, na_co_uwaga: dlugi, ocena: dlugi }));
  assert.ok(s.czego_dotyczy.length <= 700);
  assert.ok(s.na_co_uwaga.length <= 600);
  assert.ok(s.ocena.length <= 500);
});

// ---------------- dniDoTerminu ----------------

test('dniDoTerminu: liczy dni w górę (ceil), przeszłość ujemnie, brak = null', () => {
  const now = '2026-07-11T12:00:00.000Z';
  assert.equal(dniDoTerminu('2026-07-14T12:00:00.000Z', now), 3);
  assert.equal(dniDoTerminu('2026-07-11T20:00:00.000Z', now), 1, 'część doby liczy w górę');
  assert.ok(dniDoTerminu('2026-07-01T12:00:00.000Z', now) < 0, 'termin miniony');
  assert.equal(dniDoTerminu(null, now), null);
  assert.equal(dniDoTerminu('nonsens', now), null);
});

// ---------------- buildSummaryPrompt ----------------

test('prompt niesie kluczowe dane przetargu i jest deterministyczny', () => {
  const tender = {
    title: 'Remont dachu szkoły podstawowej nr 3',
    organization: 'Gmina Aleksandrów',
    cpv_main: '45261000-4',
    budget: 250000,
    currency: 'PLN',
    deadline: '2026-07-14T12:00:00.000Z',
  };
  const now = '2026-07-11T12:00:00.000Z';
  const p = buildSummaryPrompt(tender, now);
  assert.match(p, /Remont dachu szkoły/);
  assert.match(p, /Gmina Aleksandrów/);
  assert.match(p, /45261000-4/);
  assert.match(p, /250000|250 000/);
  assert.match(p, /3 dni|za 3/, 'liczba dni do terminu wyliczona z now');
  assert.equal(p, buildSummaryPrompt(tender, now), 'deterministyczny przy tym samym now');
});

test('prompt niesie wadium, gdy znane (twardy próg)', () => {
  const now = '2026-07-11T12:00:00.000Z';
  const zWadium = buildSummaryPrompt({ title: 'Remont', wadium_wymagane: true, wadium_kwota: 7800 }, now);
  assert.match(zWadium, /Wadium: wymagane, ok\. 7800 zł/);
  const bez = buildSummaryPrompt({ title: 'Dostawa', wadium_wymagane: false }, now);
  assert.match(bez, /Wadium: nie jest wymagane/);
});

test('prompt znosi braki: nieznana wartość i brak terminu bez wywrotki', () => {
  const tender = { title: 'Dostawa materiałów biurowych', organization: null, cpv_main: null, budget: null };
  const p = buildSummaryPrompt(tender, '2026-07-11T12:00:00.000Z');
  assert.match(p, /Dostawa materiałów/);
  assert.match(p, /nieznan|brak/i, 'brakujące pola opisane słownie, nie „null”');
  assert.doesNotMatch(p, /null/, 'żadnego surowego null w promptcie');
});
