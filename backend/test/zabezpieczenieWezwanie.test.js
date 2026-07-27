import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generujWezwanieDoZwrotu,
  wezwanieDoPliku,
} from '../src/lib/zabezpieczenieWezwanie.js';

/*
 * Generator WEZWANIA DO ZWROTU ZABEZPIECZENIA (ulepszenie „pilnuj zwrotu swoich
 * pieniędzy po kontrakcie"). Czysta funkcja bez I/O i sieci; „dzisiaj" wstrzykiwane.
 *
 * Dwa warianty:
 *  • „zwykłe" — kwota wymagalna, pismo powołuje harmonogram zwrotu z art. 453 Pzp,
 *  • „przeterminowane" — po terminie: pismo dokłada ścieżkę roszczenia z bezpodstawnego
 *    wzbogacenia (art. 405 KC), nalicza odsetki za opóźnienie i żąda kwoty z odsetkami.
 */

const BAZA = {
  kwota: 35_000,
  termin: '2027-06-30',
  numerUmowy: 'ZP/12/2026',
  przedmiot: 'Budowa drogi gminnej',
  wykonawca: 'Firma Budowlana Sp. z o.o.',
  zamawiajacy: 'Gmina Przykładowa',
  miejscowosc: 'Warszawa',
  dataPisma: '2027-07-01',
};

test('wezwanie zwykłe: powołuje art. 453 Pzp, żąda kwoty bez odsetek', () => {
  const w = generujWezwanieDoZwrotu({ ...BAZA, dzisiaj: '2027-06-30' });
  assert.equal(w.wariant, 'zwykle');
  assert.equal(w.odsetki, 0);
  assert.equal(w.kwotaZadania, 35_000, 'bez zwłoki żądamy samej kwoty zabezpieczenia');
  assert.match(w.tresc, /WEZWANIE DO ZWROTU ZABEZPIECZENIA/);
  assert.match(w.tresc, /art\. ?453/);
  assert.ok(!/art\. ?405/.test(w.tresc), 'bez przeterminowania nie powołujemy art. 405 KC');
});

test('wezwanie przeterminowane: dokłada art. 405 KC + odsetki i żąda kwoty z odsetkami', () => {
  // 35 000 zł zwłoki 365 dni przy 10%/rok = 3 500 zł odsetek → żądanie 38 500 zł.
  const w = generujWezwanieDoZwrotu({ ...BAZA, dzisiaj: '2028-06-30', stopaRoczna: 10 });
  assert.equal(w.wariant, 'przeterminowane');
  assert.equal(w.dni, 366, '2027-06-30 → 2028-06-30 (rok przestępny) = 366 dni zwłoki');
  assert.ok(w.odsetki > 0, 'zwłoka → odsetki > 0');
  assert.equal(w.kwotaZadania, Math.round((w.kwota + w.odsetki) * 100) / 100, 'żądanie = kwota + odsetki (grosz się zgadza)');
  assert.match(w.tresc, /art\. ?405/, 'bezpodstawne wzbogacenie');
  assert.match(w.tresc, /odsetk/i);
  assert.match(w.tresc, /brak.*sankcji|nie przewiduje.*sankcji/i, 'ostrzeżenie o braku sankcji z Pzp');
});

test('wezwanie: stawka odsetek jest jawnie wypisana w treści (nic ukrytego)', () => {
  const w = generujWezwanieDoZwrotu({ ...BAZA, dzisiaj: '2028-06-30', stopaRoczna: 12.5 });
  assert.match(w.tresc, /12,5\s?%/, 'użyta stopa odsetek wprost w piśmie');
});

test('wezwanie: nazwa pliku bez diakrytyków, oparta o numer umowy', () => {
  const w = generujWezwanieDoZwrotu({ ...BAZA, dzisiaj: '2027-06-30' });
  assert.match(w.nazwaPliku, /^wezwanie-do-zwrotu-zabezpieczenia-.*\.txt$/);
  assert.ok(!/[ąćęłńóśźż]/i.test(w.nazwaPliku), 'slug bez polskich znaków');
});

test('wezwanieDoPliku: deskryptor pliku tekstowego', () => {
  const w = generujWezwanieDoZwrotu({ ...BAZA, dzisiaj: '2027-06-30' });
  const plik = wezwanieDoPliku(w);
  assert.equal(plik.nazwa, w.nazwaPliku);
  assert.match(plik.typ, /text\/plain/);
  assert.equal(plik.zawartosc, w.tresc);
});

test('wezwanieDoPliku: brak treści → rzuca (nie ma czego eksportować)', () => {
  assert.throws(() => wezwanieDoPliku({ tresc: null }));
});
