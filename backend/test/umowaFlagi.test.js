import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbuduj_flagi_umowy } from '../src/lib/umowaAnaliza.js';

/*
 * Scalenie detektorów w jeden wynik — jednolita lista flag (podzadanie 7/12
 * ulepszenia „pilnowanie waloryzacji i pułapek w umowie").
 *
 * `zbuduj_flagi_umowy(tekst, miesiace)` uruchamia wszystkie cztery detektory
 * (waloryzacja, kary, odbiory, podwykonawcy) i sprowadza ich wyniki do JEDNEGO
 * kontraktu: lista flag `[{ typ, kolor, tytul, opis }]`. Każdy obszar umowy daje
 * DOKŁADNIE jedną flagę, w stałej kolejności. `kolor` reużywa trójstopniowej skali
 * detektorów: `zielony` (ok), `pomarańczowy` (uwaga/ryzyko), `czerwony` (pułapka
 * / naruszenie) — spójnie z polem `poziom` w ich ostrzeżeniach.
 */

const KOLORY = new Set(['zielony', 'pomarańczowy', 'czerwony']);
const TYPY = ['waloryzacja', 'kary', 'odbiory', 'podwykonawcy'];

function flagaTypu(flagi, typ) {
  return flagi.find((f) => f.typ === typ);
}

test('zwraca dokładnie jedną flagę na obszar, w stałej kolejności, z poprawnym kształtem', () => {
  for (const tekst of ['', 'Umowa na roboty budowlane, termin realizacji.']) {
    const flagi = zbuduj_flagi_umowy(tekst);
    assert.deepEqual(flagi.map((f) => f.typ), TYPY,
      `flagi w stałej kolejności dla wejścia ${JSON.stringify(tekst)}`);
    for (const f of flagi) {
      assert.ok(KOLORY.has(f.kolor), `kolor z dozwolonej skali: ${f.kolor}`);
      assert.equal(typeof f.tytul, 'string');
      assert.ok(f.tytul.length > 0, 'tytul niepusty');
      assert.equal(typeof f.opis, 'string');
      assert.ok(f.opis.length > 0, 'opis niepusty');
    }
  }
});

test('klauzula waloryzacyjna obecna => zielona flaga waloryzacji', () => {
  const tekst = 'Wynagrodzenie podlega waloryzacji, gdy wskaźnik zmieni się o ponad 10%; '
    + 'łączna zmiana wynagrodzenia nie przekroczy 20%.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst), 'waloryzacja');
  assert.equal(f.kolor, 'zielony', JSON.stringify(f));
});

test('brak klauzuli, a umowa dłuższa niż 6 miesięcy => czerwona flaga waloryzacji', () => {
  const tekst = 'Umowa na dostawę materiałów. Wykonawca dostarczy towar zgodnie z harmonogramem.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst, 12), 'waloryzacja');
  assert.equal(f.kolor, 'czerwony', JSON.stringify(f));
  assert.match(f.opis, /439/, 'czerwona flaga cytuje podstawę prawną (art. 439 Pzp)');
});

test('brak klauzuli przy nieznanym czasie trwania => pomarańczowa flaga (uwaga, nie naruszenie)', () => {
  const tekst = 'Umowa na dostawę materiałów. Wykonawca dostarczy towar zgodnie z harmonogramem.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst), 'waloryzacja');
  assert.equal(f.kolor, 'pomarańczowy', JSON.stringify(f));
});

test('kary umowne bez limitu => czerwona flaga kar', () => {
  const tekst = 'Wykonawca zapłaci karę umowną w wysokości 0,2% wynagrodzenia za każdy dzień zwłoki.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst), 'kary');
  assert.equal(f.kolor, 'czerwony', JSON.stringify(f));
});

test('kary umowne z limitem łącznej wysokości => zielona flaga kar', () => {
  const tekst = 'Wykonawca zapłaci karę umowną 0,2% wynagrodzenia za każdy dzień zwłoki. '
    + 'Łączna wysokość kar umownych nie przekroczy 20% wynagrodzenia.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst), 'kary');
  assert.equal(f.kolor, 'zielony', JSON.stringify(f));
});

test('odbiór warunkowany brakiem wad => pomarańczowa flaga odbiorów', () => {
  const tekst = 'Odbiór końcowy nastąpi po stwierdzeniu wykonania wszystkich robót bez wad i usterek.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst), 'odbiory');
  assert.equal(f.kolor, 'pomarańczowy', JSON.stringify(f));
});

test('zakaz podwykonawstwa => pomarańczowa flaga podwykonawców', () => {
  const tekst = 'Zakaz podwykonawstwa. Wykonawca zobowiązany jest do osobistego wykonania przedmiotu umowy.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst), 'podwykonawcy');
  assert.equal(f.kolor, 'pomarańczowy', JSON.stringify(f));
});

test('kolor i treść czerwonej flagi pochodzą z ostrzeżenia detektora (spójność severity)', () => {
  const tekst = 'Wykonawca zapłaci karę umowną 5% wynagrodzenia za każdy dzień opóźnienia.';
  const f = flagaTypu(zbuduj_flagi_umowy(tekst), 'kary');
  assert.equal(f.kolor, 'czerwony');
  assert.match(f.tytul, /limit/i, 'tytuł opisuje pułapkę braku limitu');
  assert.match(f.opis, /limit/i, 'opis ostrzega o braku limitu');
});
