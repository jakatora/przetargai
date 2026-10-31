import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latOdUprawnien, odmianaLat, odczytajBank, walidujOsobe, walidujRealizacje, sortujOsoby, podsumowanieOsoby, generujWykazOsob, FUNKCJE, PODSTAWY,
} from '../src/lib/bankOsob.js';

const KIEROWNIK = {
  id: 'o1', imie: 'Jan Kowalski', funkcja: 'kierownik_budowy',
  uprawnienia: 'nr PDK/0123/POOK/12 do kierowania robotami budowlanymi w specjalności konstrukcyjno-budowlanej bez ograniczeń',
  uprawnieniaData: '2012-06-15', izba: 'PDK/BO/1234/12', wyksztalcenie: 'wyższe techniczne, budownictwo', podstawa: 'umowa_o_prace',
  realizacje: [
    { id: 'r1', nazwa: 'Przebudowa szkoły w Jarosławiu', rola: 'kierownik budowy', zamawiajacy: 'Gmina Jarosław', wartosc: '2450000', dataZakonczenia: '2024-09-30' },
    { id: 'r2', nazwa: 'Termomodernizacja przedszkola', rola: 'kierownik budowy', dataZakonczenia: '2022-05-10' },
  ],
};
const INSPEKTOR = { id: 'o2', imie: 'Anna Nowak', funkcja: 'inspektor', podstawa: 'podmiot_trzeci', realizacje: [] };

test('lata od uprawnień: pełne lata, dzień przed rocznicą jeszcze nie; zła lub przyszła data → null', () => {
  assert.equal(latOdUprawnien('2012-06-15', '2026-06-15'), 14);
  assert.equal(latOdUprawnien('2012-06-15', '2026-06-14T10:00:00.000Z'), 13);
  assert.equal(latOdUprawnien('2027-01-01', '2026-10-31'), null);
  assert.equal(latOdUprawnien('2024-02-31', '2026-10-31'), null);
  assert.equal(latOdUprawnien('', '2026-10-31'), null);
  assert.deepEqual([1, 3, 5, 12, 22, 25].map(odmianaLat), ['1 rok', '3 lata', '5 lat', '12 lat', '22 lata', '25 lat']);
});

test('odczyt z magazynu odporny na śmieci; walidacja formularzy z komunikatami PL/EN', () => {
  assert.deepEqual(odczytajBank('nie json'), []);
  assert.deepEqual(odczytajBank('{"a":1}'), []);
  const lista = odczytajBank(JSON.stringify([KIEROWNIK, { imie: '' }, null, { imie: 'Ewa', realizacje: 'zle' }]));
  assert.deepEqual(lista.map((o) => [o.imie, o.realizacje.length]), [['Jan Kowalski', 2], ['Ewa', 0]]);
  assert.equal(walidujOsobe({ imie: ' ' }).bledy.imie.pl, 'Podaj imię i nazwisko.');
  assert.ok(walidujOsobe({ imie: 'Jan', dataUprawnien: '15.06.2012' }).bledy.dataUprawnien);
  assert.equal(walidujOsobe({ imie: 'Jan', dataUprawnien: '' }).maBledy, false);
  const r = walidujRealizacje({ nazwa: '', dataZakonczenia: '2024-13-01', wartosc: 'dużo' });
  assert.deepEqual(Object.keys(r.bledy).sort(), ['dataZakonczenia', 'nazwa', 'wartosc']);
  assert.equal(walidujRealizacje({ nazwa: 'X', wartosc: '1 250 000,50' }).maBledy, false);
});

test('kolejność: kierownik budowy przed inspektorem; skrót osoby', () => {
  assert.deepEqual(sortujOsoby([INSPEKTOR, KIEROWNIK]).map((o) => o.id), ['o1', 'o2']);
  assert.deepEqual(podsumowanieOsoby(KIEROWNIK, '2026-10-31'), { lat: 14, realizacji: 2, posredni: false });
  assert.equal(podsumowanieOsoby(INSPEKTOR, '2026-10-31').posredni, true);
});

test('wykaz osób: kolumny z rozporządzenia, najnowsza realizacja pierwsza, przypomnienie o zobowiązaniu art. 118', () => {
  const dok = generujWykazOsob({
    wykonawca: { nazwa: 'Budmax Sp. z o.o.', adres: 'ul. Długa 1, Przeworsk', nip: '7941234567', miejscowosc: 'Przeworsk', reprezentant: 'Piotr Budny', stanowisko: 'Prezes Zarządu' },
    przetarg: { zamawiajacy: 'Gmina Kańczuga', tytul: 'Budowa świetlicy', numer: '2026/BZP 00510580' },
    osoby: [INSPEKTOR, KIEROWNIK],
    dzisiaj: '2026-10-31T12:00:00.000Z',
  });
  assert.equal(dok.liczba, 2);
  assert.equal(dok.posrednich, 1);
  const t = dok.tresc;
  assert.match(t, /^WYKAZ OSÓB\n/);
  assert.match(t, /§ 9 ust\. 1 pkt 3/);
  assert.match(t, /Postępowanie: Budowa świetlicy \(nr 2026\/BZP 00510580\)/);
  assert.ok(t.indexOf('1. Jan Kowalski') < t.indexOf('2. Anna Nowak'));
  assert.match(t, /uzyskane 15\.06\.2012 \(14 lat\)/);
  assert.match(t, /Przynależność do izby samorządu zawodowego: PDK\/BO\/1234\/12/);
  assert.ok(t.indexOf('Przebudowa szkoły') < t.indexOf('Termomodernizacja'), 'najnowsza realizacja pierwsza');
  assert.match(t, /wartość 2\s450\s000,00 zł brutto/);
  assert.match(t, /Podstawa dysponowania: umowa o pracę\n/);
  assert.match(t, /zasób innego podmiotu \(art\. 118 Pzp\) — zobowiązanie podmiotu udostępniającego w załączeniu/);
  assert.match(t, /Przeworsk, 31\.10\.2026/);
  assert.match(t, /Piotr Budny, Prezes Zarządu/);
  const pusty = generujWykazOsob({ osoby: [], dzisiaj: '2026-10-31' });
  assert.equal(pusty.liczba, 0);
  assert.match(pusty.tresc, /brak osób/);
});

test('etykiety funkcji i podstaw w obu językach', () => {
  for (const s of [FUNKCJE, PODSTAWY]) for (const [k, v] of Object.entries(s)) assert.ok(v.pl && v.en, k);
});
