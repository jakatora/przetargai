import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wybierzDoWykazu, generujWykaz } from '../src/lib/wykazReferencji.js';

/*
 * „Wykaz wykonanych robót / usług / dostaw w 1 klik" — z Banku referencji (dane już
 * w aplikacji) powstaje załącznik wymagany na wezwanie z art. 274. Liczy się TYLKO
 * doświadczenie aktualne na dzień składania (5 lat roboty / 3 lata usługi i dostawy),
 * bo wygasła referencja w wykazie to niespełniony warunek i odrzucenie.
 */

const TERAZ = Date.parse('2026-10-24T10:00:00Z');
const REFERENCJE = [
  { id: 'a', przedmiot: 'Remont dachu SP nr 3', rodzaj: 'roboty', wartosc: 480000, zamawiajacy: 'Gmina Kraków', dataZakonczenia: '2024-06-30' },
  { id: 'b', przedmiot: 'Termomodernizacja przedszkola', rodzaj: 'roboty', wartosc: 1250000, zamawiajacy: 'Gmina Wieliczka', dataZakonczenia: '2020-05-15' }, // > 5 lat — wygasła
  { id: 'c', przedmiot: 'Sprzątanie biur', rodzaj: 'uslugi', wartosc: 90000, zamawiajacy: 'ZUS Oddział Kraków', dataZakonczenia: '2025-01-31' },
  { id: 'd', przedmiot: 'Dostawa papieru', rodzaj: 'dostawy', wartosc: 30000, zamawiajacy: 'UM Kraków', dataZakonczenia: '2022-09-01' }, // > 3 lata — wygasła
];
const WYKONAWCA = { nazwa: 'Budrem Sp. z o.o.', adres: 'ul. Długa 12, Kraków', nip: '5261040827', reprezentant: 'Jan Kowalski', miejscowosc: 'Kraków' };
const PRZETARG = { tytul: 'Remont dachu szkoły', zamawiajacy: 'Gmina Miejska Kraków', numer: 'ZP.271.14.2026' };

test('wybierzDoWykazu: tylko aktualne i tylko wskazanego rodzaju, od najnowszych; wygasłe osobno', () => {
  const w = wybierzDoWykazu(REFERENCJE, { rodzaj: 'roboty', teraz: TERAZ });
  assert.deepEqual(w.aktualne.map((r) => r.id), ['a']);
  assert.deepEqual(w.wygasle.map((r) => r.id), ['b']);

  const wszystkie = wybierzDoWykazu(REFERENCJE, { teraz: TERAZ });
  assert.deepEqual(wszystkie.aktualne.map((r) => r.id), ['c', 'a'], 'bez rodzaju: wszystkie aktualne, najnowsze pierwsze');
  assert.deepEqual(wybierzDoWykazu(null, { teraz: TERAZ }), { aktualne: [], wygasle: [] });
});

test('generujWykaz: tabela pozycji z wartością PLN, datą, odbiorcą; kolumna dowodów; podpis', () => {
  const dok = generujWykaz({ wykonawca: WYKONAWCA, przetarg: PRZETARG, referencje: REFERENCJE, rodzaj: 'roboty', teraz: TERAZ, dzisiaj: '2026-10-24T10:00:00Z' });
  assert.equal(dok.nazwa, 'Wykaz wykonanych robót budowlanych');
  assert.match(dok.tresc, /WYKAZ ROBÓT BUDOWLANYCH/);
  assert.match(dok.tresc, /ostatnich 5 lat/);
  assert.match(dok.tresc, /1\. Remont dachu SP nr 3/);
  assert.match(dok.tresc, /480 000,00 zł/);
  assert.match(dok.tresc, /30\.06\.2024/);
  assert.match(dok.tresc, /Gmina Kraków/);
  assert.match(dok.tresc, /Dowody: referencje/i);
  assert.doesNotMatch(dok.tresc, /Termomodernizacja/, 'wygasła nie trafia do wykazu');
  assert.match(dok.tresc, /Gmina Miejska Kraków/);
  assert.match(dok.tresc, /Jan Kowalski/);
  assert.match(dok.tresc, /podpis kwalifikowany/i);
  assert.equal(dok.liczba, 1);
  assert.deepEqual(dok.pominiete.map((r) => r.id), ['b']);
});

test('generujWykaz: usługi = okno 3 lat; pusty wykaz ma jasny komunikat zamiast pustej tabeli', () => {
  const u = generujWykaz({ wykonawca: WYKONAWCA, przetarg: PRZETARG, referencje: REFERENCJE, rodzaj: 'uslugi', teraz: TERAZ, dzisiaj: '2026-10-24' });
  assert.match(u.tresc, /WYKAZ USŁUG/);
  assert.match(u.tresc, /ostatnich 3 lat/);
  assert.match(u.tresc, /Sprzątanie biur/);

  const pusty = generujWykaz({ wykonawca: WYKONAWCA, przetarg: PRZETARG, referencje: [], rodzaj: 'dostawy', teraz: TERAZ, dzisiaj: '2026-10-24' });
  assert.equal(pusty.liczba, 0);
  assert.match(pusty.tresc, /brak pozycji/i);
  assert.doesNotMatch(pusty.tresc, /undefined|NaN/);
});

test('generujWykaz: nie rzuca na pustych danych', () => {
  const dok = generujWykaz({});
  assert.ok(dok.tresc.length > 50);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});
