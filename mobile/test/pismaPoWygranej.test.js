import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKLISTA_PO_WYGRANEJ,
  generujZgloszeniePodwykonawcy,
  generujWniosekOZmianeTerminu,
  generujWniosekOZwrotZabezpieczenia,
} from '../src/lib/pismaPoWygranej.js';

/*
 * „Po wygranej" — trzy pisma, które każdy wykonawca pisze sam po podpisaniu umowy,
 * i checklista pierwszych dni kontraktu. Czysta logika, bez zegara (`dzisiaj`).
 */

const WYKONAWCA = { nazwa: 'Budrem Sp. z o.o.', adres: 'ul. Długa 12, Kraków', nip: '5261040827', email: 'biuro@budrem.pl', reprezentant: 'Jan Kowalski', miejscowosc: 'Kraków' };
const UMOWA = { tytul: 'Remont dachu SP 3', zamawiajacy: 'Gmina Kraków', numer: 'ZP.271.14.2026', numerUmowy: 'UM/45/2026', dataUmowy: '2026-11-03' };

test('checklista po wygranej: ma stałe id, kolejność od podpisania do pierwszej faktury, część z ekranem narzędzia', () => {
  const ids = CHECKLISTA_PO_WYGRANEJ.map((p) => p.id);
  assert.ok(ids.length >= 7);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.indexOf('zabezpieczenie') < ids.indexOf('faktura'));
  assert.ok(CHECKLISTA_PO_WYGRANEJ.some((p) => p.ekran === 'ZabezpieczenieZwrot'));
  assert.ok(Object.isFrozen(CHECKLISTA_PO_WYGRANEJ));
});

test('zgłoszenie podwykonawcy robót: art. 464 ust. 1, dane podwykonawcy, zakres, projekt umowy w załączeniu, termin 14 dni na zastrzeżenia', () => {
  const dok = generujZgloszeniePodwykonawcy({
    wykonawca: WYKONAWCA, umowa: UMOWA, dzisiaj: '2026-11-10', rodzaj: 'roboty',
    podwykonawca: { nazwa: 'Elektro-Bud s.c.', adres: 'ul. Krótka 2, Wieliczka', nip: '6830000000', zakres: 'instalacje elektryczne w budynku szkoły', wartosc: '85 000' },
  });
  assert.equal(dok.nazwa, 'Zgłoszenie podwykonawcy robót budowlanych');
  assert.match(dok.tresc, /art\. 464 ust\. 1/);
  assert.match(dok.tresc, /Elektro-Bud s\.c\./);
  assert.match(dok.tresc, /instalacje elektryczne/);
  assert.match(dok.tresc, /85 000,00 zł/);
  assert.match(dok.tresc, /projekt umowy o podwykonawstwo/i);
  assert.match(dok.tresc, /14 dni/);
  assert.match(dok.tresc, /UM\/45\/2026/);
  assert.match(dok.tresc, /Jan Kowalski/);
});

test('zgłoszenie podwykonawcy dostaw/usług: art. 464 ust. 8, kopia zawartej umowy zamiast projektu', () => {
  const dok = generujZgloszeniePodwykonawcy({ wykonawca: WYKONAWCA, umowa: UMOWA, dzisiaj: '2026-11-10', rodzaj: 'uslugi', podwykonawca: { nazwa: 'Transport Nowak' } });
  assert.match(dok.tresc, /art\. 464 ust\. 8/);
  assert.match(dok.tresc, /poświadczon\S+ za zgodność z oryginałem kopi\S+ zawartej umowy/i);
  assert.doesNotMatch(dok.tresc, /14 dni/);
});

test('wniosek o zmianę terminu: klauzula umowna (art. 455 ust. 1 pkt 1) vs okoliczności nieprzewidywalne (pkt 4); nowy termin i uzasadnienie', () => {
  const kl = generujWniosekOZmianeTerminu({ wykonawca: WYKONAWCA, umowa: UMOWA, dzisiaj: '2026-11-20', podstawa: 'klauzula', nowyTermin: '2027-01-31', uzasadnienie: 'Dostawa dachówki opóźniona przez producenta — pismo w załączeniu.', paragrafKlauzuli: '§ 12 ust. 2 pkt 3' });
  assert.equal(kl.nazwa, 'Wniosek o zmianę terminu wykonania umowy');
  assert.match(kl.tresc, /art\. 455 ust\. 1 pkt 1/);
  assert.match(kl.tresc, /§ 12 ust\. 2 pkt 3/);
  assert.match(kl.tresc, /31\.01\.2027/);
  assert.match(kl.tresc, /Dostawa dachówki opóźniona/);
  assert.match(kl.tresc, /aneks/i);

  const nie = generujWniosekOZmianeTerminu({ wykonawca: WYKONAWCA, umowa: UMOWA, dzisiaj: '2026-11-20', podstawa: 'nieprzewidywalne', nowyTermin: '2027-01-31', uzasadnienie: 'Odkryto niezinwentaryzowaną sieć gazową.' });
  assert.match(nie.tresc, /art\. 455 ust\. 1 pkt 4/);
  assert.match(nie.tresc, /nie mógł przewidzieć/i);
  assert.doesNotMatch(nie.tresc, /pkt 1/);
});

test('wniosek o zwrot zabezpieczenia: 70% w 30 dni po odbiorze (art. 453 ust. 1) albo 30% w 15 dni po rękojmi (ust. 3); kwota PLN', () => {
  const a = generujWniosekOZwrotZabezpieczenia({ wykonawca: WYKONAWCA, umowa: UMOWA, dzisiaj: '2027-03-01', etap: 'po_odbiorze', kwotaZabezpieczenia: '50 000', dataOdbioru: '2027-02-20', rachunek: '12 1240 0001 1111 0010 1234 5678' });
  assert.equal(a.nazwa, 'Wniosek o zwrot zabezpieczenia należytego wykonania umowy');
  assert.match(a.tresc, /art\. 453 ust\. 1/);
  assert.match(a.tresc, /70 ?%/);
  assert.match(a.tresc, /35 000,00 zł/);
  assert.match(a.tresc, /30 dni/);
  assert.match(a.tresc, /20\.02\.2027/);
  assert.match(a.tresc, /12 1240 0001/);

  const b = generujWniosekOZwrotZabezpieczenia({ wykonawca: WYKONAWCA, umowa: UMOWA, dzisiaj: '2030-03-01', etap: 'po_rekojmi', kwotaZabezpieczenia: '50000', dataKoncaRekojmi: '2030-02-20' });
  assert.match(b.tresc, /art\. 453 ust\. 3/);
  assert.match(b.tresc, /30 ?%/);
  assert.match(b.tresc, /15 000,00 zł/);
  assert.match(b.tresc, /15 dni/);
});

test('wszystkie trzy pisma nie rzucają na pustych danych i nie zawierają „undefined"', () => {
  for (const dok of [generujZgloszeniePodwykonawcy({}), generujWniosekOZmianeTerminu({}), generujWniosekOZwrotZabezpieczenia({})]) {
    assert.ok(dok.tresc.length > 80);
    assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
  }
});
