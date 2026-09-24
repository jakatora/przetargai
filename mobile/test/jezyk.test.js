import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Przełącznik języka PL/EN (P1-5).
 *
 * Backend oddaje teksty jako pary `{ pl, en }` — opisy źródeł, stan pobierania,
 * wyjaśnienie dopasowania, zastrzeżenie o zakresie danych. Aplikacja potrzebuje
 * JEDNEGO miejsca, które wybiera z pary właściwy język i nie wywraca się, gdy
 * backend odda sam string albo zapomni o angielskim.
 *
 * Interfejs aplikacji pozostaje domyślnie polski — to jest dobudowa, nie
 * przebudowa UI.
 */

const J = await import('../src/lib/jezyk.js');

test('domyślny język to polski', () => {
  assert.equal(J.JEZYK_DOMYSLNY, 'pl');
  assert.equal(J.normalizujJezyk(undefined), 'pl');
  assert.equal(J.normalizujJezyk('klingon'), 'pl');
  assert.equal(J.normalizujJezyk(null), 'pl');
});

test('normalizacja przyjmuje warianty regionalne', () => {
  assert.equal(J.normalizujJezyk('en'), 'en');
  assert.equal(J.normalizujJezyk('EN'), 'en');
  assert.equal(J.normalizujJezyk('en-GB'), 'en');
  assert.equal(J.normalizujJezyk('pl-PL'), 'pl');
});

test('tr wybiera wariant językowy z pary', () => {
  const para = { pl: 'Kody CPV', en: 'CPV codes' };
  assert.equal(J.tr(para, 'pl'), 'Kody CPV');
  assert.equal(J.tr(para, 'en'), 'CPV codes');
});

test('KRYTYCZNE: brak tłumaczenia spada na polski, nie na pusty ekran', () => {
  assert.equal(J.tr({ pl: 'Tylko po polsku' }, 'en'), 'Tylko po polsku');
  assert.equal(J.tr({ en: 'English only' }, 'pl'), 'English only');
});

test('zwykły string przechodzi bez zmian — stare ekrany nic nie tracą', () => {
  assert.equal(J.tr('Zapisane', 'en'), 'Zapisane');
});

test('puste wejście daje pusty tekst, nie „undefined" na ekranie', () => {
  assert.equal(J.tr(null, 'pl'), '');
  assert.equal(J.tr(undefined, 'en'), '');
  assert.equal(J.tr({}, 'pl'), '');
  assert.equal(J.tr(42, 'pl'), '42');
});

test('tworzTlumacza domyka język — ekran woła jednoargumentowo', () => {
  const t = J.tworzTlumacza('en');
  assert.equal(t({ pl: 'Wszystkie', en: 'All' }), 'All');
  assert.equal(t({ pl: 'Dla mnie', en: 'For me' }), 'For me');
});

test('tłumacz przyjmuje parę jako dwa argumenty — skrót dla literałów w ekranie', () => {
  const t = J.tworzTlumacza('en');
  assert.equal(t('Dla mnie', 'For me'), 'For me');
  assert.equal(J.tworzTlumacza('pl')('Dla mnie', 'For me'), 'Dla mnie');
});

test('język systemu jest rozpoznawany, ale wszystko poza angielskim to polski', () => {
  assert.equal(J.wykryjJezyk('en-US'), 'en');
  assert.equal(J.wykryjJezyk('pl-PL'), 'pl');
  assert.equal(J.wykryjJezyk('de-DE'), 'pl', 'rynek jest polski — niemiecki nie znaczy angielski');
  assert.equal(J.wykryjJezyk(null), 'pl');
});

test('etykiety przełącznika są w swoim własnym języku', () => {
  assert.equal(J.ETYKIETY_JEZYKOW.pl, 'Polski');
  assert.equal(J.ETYKIETY_JEZYKOW.en, 'English');
});
