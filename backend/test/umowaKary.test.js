import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Detektor KAR UMOWNYCH `wykryj_kary_umowne` — podzadanie 5/12 ulepszenia
 * „pilnowanie waloryzacji i pułapek w umowie". Czysta funkcja, testy jednostkowe
 * (bez serwera) na realistycznych fragmentach zapisów o karach umownych. Klucz:
 * czy łączna wysokość kar jest OGRANICZONA LIMITEM — brak limitu to pułapka
 * (kary, zwłaszcza dzienne, mogą przekroczyć wartość umowy), więc detektor
 * zwraca wtedy CZERWONĄ flagę. Testujemy „szczęśliwą ścieżkę" i ADWERSARYJNIE:
 * że % waloryzacji, VAT-u ani zabezpieczenia nie wyląduje na liście kar, a limit
 * łącznej wysokości kar nie zostanie policzony jako kolejna kara (nie zawyża sumy).
 */

const { wykryj_kary_umowne } = await import('../src/lib/umowaKary.js');

const KARY_Z_LIMITEM = `
§ 10. Kary umowne.
1. Wykonawca zapłaci Zamawiającemu karę umowną za zwłokę w wykonaniu przedmiotu
umowy w wysokości 0,2% wynagrodzenia brutto za każdy dzień zwłoki.
2. Wykonawca zapłaci karę umowną za odstąpienie od umowy z przyczyn leżących po
jego stronie w wysokości 10% wynagrodzenia brutto.
3. Łączna wysokość kar umownych nie przekroczy 20% wynagrodzenia brutto.
`;

test('wykrywa kary, sumuje stawki i rozpoznaje limit łącznej wysokości', () => {
  const r = wykryj_kary_umowne(KARY_Z_LIMITEM);
  assert.equal(r.kary.length, 2, 'dwie kary jednostkowe (0,2% i 10%), limit 20% to nie kara');
  assert.equal(r.suma, 10.2);
  assert.equal(r.limit, 20);
  assert.equal(r.czy_ograniczona_limitem, true);
  assert.equal(r.ostrzezenie, null, 'jest limit → brak czerwonej flagi');
  assert.ok(r.kary.some((k) => k.za_kazdy_dzien), 'kara 0,2% jest naliczana za każdy dzień');
});

test('kary bez limitu łącznej wysokości → czerwona flaga „kary umowne bez limitu"', () => {
  const t = 'Kary umowne. Wykonawca zapłaci karę umowną za zwłokę w wysokości 0,5% '
    + 'wynagrodzenia za każdy dzień opóźnienia oraz karę umowną za odstąpienie od '
    + 'umowy w wysokości 15% wynagrodzenia.';
  const r = wykryj_kary_umowne(t);
  assert.equal(r.kary.length, 2);
  assert.equal(r.limit, null);
  assert.equal(r.czy_ograniczona_limitem, false);
  assert.ok(r.ostrzezenie, 'brak limitu → ostrzezenie obecne');
  assert.equal(r.ostrzezenie.poziom, 'czerwony');
  assert.equal(r.ostrzezenie.kod, 'brak_limitu_kar');
  assert.match(r.opis, /nie wykryto limitu|bez.*limitu/i);
});

test('ADWERSARYJNIE: % waloryzacji i VAT nie trafiają na listę kar', () => {
  const t = 'Kary umowne. Kara umowna za zwłokę 0,2% za każdy dzień, łączna wysokość '
    + 'kar nie przekroczy 20% wynagrodzenia. '
    + 'Klauzula waloryzacyjna: wynagrodzenie zmienia się, gdy ceny wzrosną o 8%, '
    + 'a łączna waloryzacja nie przekroczy 15%. Do cen dolicza się VAT 23%.';
  const r = wykryj_kary_umowne(t);
  assert.equal(r.kary.length, 1, 'tylko kara 0,2%; 8%/15% waloryzacji i 23% VAT poza listą');
  assert.equal(r.suma, 0.2);
  assert.equal(r.limit, 20);
  assert.equal(r.czy_ograniczona_limitem, true);
});

test('ADWERSARYJNIE: limit „nie przekroczy 20%" nie jest liczony jako kara (nie zawyża sumy)', () => {
  const t = 'Kary umowne. Kara umowna za odstąpienie od umowy wynosi 10% wynagrodzenia. '
    + 'Łączna wysokość kar umownych nie może przekroczyć 20% wynagrodzenia.';
  const r = wykryj_kary_umowne(t);
  assert.equal(r.kary.length, 1);
  assert.equal(r.suma, 10);
  assert.equal(r.limit, 20);
  assert.equal(r.czy_ograniczona_limitem, true);
});

test('ADWERSARYJNIE: % zabezpieczenia należytego wykonania nie jest karą', () => {
  const t = 'Zabezpieczenie należytego wykonania umowy ustala się na 5% wynagrodzenia. '
    + 'Kary umowne: za zwłokę 0,1% za każdy dzień, bez ograniczenia łącznej wysokości.';
  const r = wykryj_kary_umowne(t);
  assert.equal(r.kary.length, 1, 'tylko 0,1%; 5% zabezpieczenia to nie kara');
  assert.equal(r.suma, 0.1);
  assert.equal(r.czy_ograniczona_limitem, false);
  assert.ok(r.ostrzezenie);
});

test('brak kar umownych → pusta lista, suma 0, bez flagi, opis prosi o weryfikację', () => {
  const t = 'Umowa na dostawę materiałów biurowych. Wynagrodzenie ryczałtowe 50 000 zł. '
    + 'Termin realizacji 30 dni. Do ceny dolicza się VAT 23%.';
  const r = wykryj_kary_umowne(t);
  assert.equal(r.kary.length, 0);
  assert.equal(r.suma, 0);
  assert.equal(r.limit, null);
  assert.equal(r.czy_ograniczona_limitem, false);
  assert.equal(r.ostrzezenie, null, 'brak kar → nie ma czego ograniczać, brak flagi');
  assert.match(r.opis, /[Nn]ie wykryto kar/);
});

test('odczytuje ułamek dziesiętny i słowo „procent" w stawce kary', () => {
  const t = 'Kary umowne. Wykonawca zapłaci karę umowną za zwłokę w wysokości 0,15% '
    + 'wynagrodzenia za każdy dzień. Za odstąpienie od umowy kara umowna wynosi '
    + '12 procent wynagrodzenia. Bez limitu łącznej wysokości kar.';
  const r = wykryj_kary_umowne(t);
  assert.equal(r.kary.length, 2);
  assert.equal(r.suma, 12.15);
  assert.equal(r.czy_ograniczona_limitem, false);
});

test('wejście puste/null/undefined/nie-string → pusta lista, bez wyjątku', () => {
  for (const w of [null, undefined, '', '    ', 123]) {
    const r = wykryj_kary_umowne(w);
    assert.equal(r.kary.length, 0, `dla wejścia ${JSON.stringify(w)}`);
    assert.equal(r.suma, 0);
    assert.equal(r.limit, null);
    assert.equal(r.czy_ograniczona_limitem, false);
    assert.equal(r.ostrzezenie, null);
    assert.equal(typeof r.opis, 'string');
  }
});
