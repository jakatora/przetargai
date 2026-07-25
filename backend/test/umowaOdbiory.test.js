import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Detektor ZAPISÓW O ODBIORACH `wykryj_odbiory` — podzadanie 6/12 ulepszenia
 * „pilnowanie waloryzacji i pułapek w umowie". Czysta funkcja, testy jednostkowe
 * (bez serwera) na realistycznych fragmentach zapisów o odbiorach. Klucz: czy
 * odbiór jest warunkowany BRAKIEM WAD/USTEREK — to pułapka (drobna usterka blokuje
 * odbiór i płatność), więc detektor zwraca wtedy pomarańczową flagę. Testujemy
 * „szczęśliwą ścieżkę" oraz ADWERSARYJNIE: że „odbiorca" (adresat) nie jest brany
 * za odbiór, a nota o płatności po protokole nie pojawia się bez kontekstu zapłaty.
 */

const { wykryj_odbiory } = await import('../src/lib/umowaOdbiory.js');

const ODBIORY_TYPOWE = `
§ 8. Odbiory.
1. Strony przewidują odbiory częściowe robót oraz odbiór końcowy przedmiotu umowy.
2. Zapłata wynagrodzenia nastąpi po podpisaniu protokołu odbioru końcowego.
`;

test('wykrywa rodzaje odbioru i notę o płatności powiązanej z protokołem', () => {
  const r = wykryj_odbiory(ODBIORY_TYPOWE);
  assert.equal(r.obecne, true);
  assert.ok(r.rodzaje.includes('odbiór częściowy'), 'wykryty odbiór częściowy');
  assert.ok(r.rodzaje.includes('odbiór końcowy'), 'wykryty odbiór końcowy');
  assert.ok(r.ryzyka.some((n) => /protoko/i.test(n)), 'nota o płatności po protokole');
  assert.equal(r.ostrzezenie, null, 'brak pułapki „bez wad" → brak flagi');
  assert.match(r.opis, /odbiorach/);
});

test('odbiór warunkowany brakiem wad/usterek → pomarańczowa flaga', () => {
  const t = 'Odbiór końcowy nastąpi po stwierdzeniu, że przedmiot umowy jest wolny od '
    + 'wad i usterek. Zamawiający dokona odbioru wyłącznie bez zastrzeżeń.';
  const r = wykryj_odbiory(t);
  assert.equal(r.obecne, true);
  assert.ok(r.ostrzezenie, 'wykryty warunek braku wad → ostrzezenie obecne');
  assert.equal(r.ostrzezenie.poziom, 'pomarańczowy');
  assert.equal(r.ostrzezenie.kod, 'odbior_warunkowany_brakiem_wad');
  assert.ok(r.ryzyka.some((n) => /wad|usterek/i.test(n)));
  assert.match(r.opis, /Na co uważać/);
});

test('prawo odmowy odbioru → nota w ryzykach, ale bez flagi (to nie „bez wad")', () => {
  const t = 'Zamawiającemu przysługuje prawo odmowy odbioru robót w przypadku ich '
    + 'niezgodności z dokumentacją. Termin odbioru wynosi 14 dni od zgłoszenia.';
  const r = wykryj_odbiory(t);
  assert.equal(r.obecne, true);
  assert.ok(r.ryzyka.some((n) => /odmow/i.test(n)), 'nota o prawie odmowy odbioru');
  assert.equal(r.ostrzezenie, null, 'sama odmowa to nie flaga „bez wad"');
});

test('ADWERSARYJNIE: „odbiorca" (adresat dostawy) nie jest brany za odbiór', () => {
  const t = 'Odbiorcą dostaw jest szpital wskazany w załączniku nr 2. Odbiorcy końcowi '
    + 'zgłaszają zapotrzebowanie do dnia 10 każdego miesiąca.';
  const r = wykryj_odbiory(t);
  assert.equal(r.obecne, false, '„odbiorca/odbiorcy" to adresat, nie procedura odbioru');
  assert.equal(r.rodzaje.length, 0);
  assert.equal(r.ostrzezenie, null);
  assert.match(r.opis, /[Nn]ie wykryto zapisów o odbiorach/);
});

test('ADWERSARYJNIE: protokół odbioru bez kontekstu zapłaty → brak noty o płatności', () => {
  const t = 'Z czynności odbioru robót strony sporządzą protokół odbioru podpisany przez '
    + 'komisję. Protokół odbioru określa stan zaawansowania robót.';
  const r = wykryj_odbiory(t);
  assert.equal(r.obecne, true);
  assert.equal(r.ryzyka.length, 0, 'bez słów o płatności nota „po protokole" się nie pojawia');
  assert.equal(r.ostrzezenie, null);
});

test('brak zapisów o odbiorach → obecne=false, opis prosi o weryfikację', () => {
  const t = 'Umowa na dostawę materiałów biurowych. Wynagrodzenie ryczałtowe 50 000 zł. '
    + 'Do ceny dolicza się VAT 23%.';
  const r = wykryj_odbiory(t);
  assert.equal(r.obecne, false);
  assert.equal(r.rodzaje.length, 0);
  assert.equal(r.ryzyka.length, 0);
  assert.equal(r.ostrzezenie, null);
  assert.match(r.opis, /[Nn]ie wykryto zapisów o odbiorach/);
});

test('wejście puste/null/undefined/nie-string → bezpieczne wartości, bez wyjątku', () => {
  for (const w of [null, undefined, '', '   ', 123]) {
    const r = wykryj_odbiory(w);
    assert.equal(r.obecne, false, `dla wejścia ${JSON.stringify(w)}`);
    assert.deepEqual(r.rodzaje, []);
    assert.deepEqual(r.ryzyka, []);
    assert.equal(r.ostrzezenie, null);
    assert.equal(typeof r.opis, 'string');
  }
});
