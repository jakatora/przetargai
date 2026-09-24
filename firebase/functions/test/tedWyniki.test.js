import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mapujWynikTed, mapujModyfikacjeTed, ofertyCzesci } from '../src/services/tedWyniki.js';
import { kodWojewodztwaZNuts, NUTS2_POLSKA } from '../src/lib/nuts.js';
import { kodWojewodztwa } from '../src/lib/wojewodztwa.js';

const KATALOG = dirname(fileURLToPath(import.meta.url));
const fixture = (nazwa) =>
  JSON.parse(readFileSync(join(KATALOG, 'fixtures', `${nazwa}.json`), 'utf8'));

const WYNIKI = fixture('ted-wyniki');
const poNumerze = (numer) => WYNIKI.find((n) => n['publication-number'] === numer);

/*
 * Fixture'y pobrane z ŻYWEGO TED (2026-09-24), pola zweryfikowane sondą
 * `skrypty/sonda-ted-wyniki.mjs` na 250 ogłoszeniach.
 */
describe('TED — rozstrzygnięcia (form-type = result)', () => {
  describe('NUTS to nie TERYT (cichy błąd: Koszalin liczony jako Kielce)', () => {
    test('wspólny normalizator NADAL myli kod NUTS — dlatego jest osobny słownik', () => {
      assert.equal(kodWojewodztwa('PL426'), '26'); // świętokrzyskie — ŹLE dla TED
      assert.equal(kodWojewodztwaZNuts('PL426'), '32'); // zachodniopomorskie — dobrze
    });

    test('NUTS poziomu 3 z literą (PL22A = katowicki)', () => {
      assert.equal(kodWojewodztwaZNuts('PL22A'), '24'); // śląskie
    });

    test('oba regiony mazowieckie schodzą się do jednego województwa', () => {
      assert.equal(kodWojewodztwaZNuts('PL911'), '14');
      assert.equal(kodWojewodztwaZNuts('PL92'), '14');
    });

    test('kod spoza Polski i śmieci dają null, nie zgadywanie', () => {
      assert.equal(kodWojewodztwaZNuts('DE300'), null);
      assert.equal(kodWojewodztwaZNuts('PL999'), null);
      assert.equal(kodWojewodztwaZNuts(null), null);
    });

    test('słownik pokrywa wszystkie 17 polskich regionów NUTS2', () => {
      assert.equal(NUTS2_POLSKA.length, 17);
      assert.equal(new Set(NUTS2_POLSKA.map(kodWojewodztwaZNuts)).size, 16); // 16 województw
    });
  });

  describe('pułapka 1: tablice pól NIE są wyrównane między sobą', () => {
    // 659988-2026: 14 części, 14 nazw zwycięzców, ale tylko 7 rozmiarów firm.
    const wynik = mapujWynikTed(poNumerze('659988-2026'));

    test('liczba części pochodzi z result-lot-identifier', () => {
      assert.equal(wynik.czesci.length, 14);
    });

    test('nazwa zwycięzcy (tablica wyrównana) jest przypisana', () => {
      assert.ok(wynik.czesci[0].zwyciezca?.nazwa, 'brak zwycięzcy mimo wyrównanej tablicy');
    });

    test('rozmiar firmy (tablica NIEwyrównana) jest pomijany, a nie zgadywany', () => {
      assert.ok(wynik.czesci.every((c) => c.wielkoscWykonawcy === null),
        'przypisano rozmiar firmy z tablicy o innej długości — to cudzy rozmiar');
      assert.ok(wynik.czesci.every((c) => c.wygralMaly === null));
    });

    test('ceny z wyrównanej tablicy tender-value są czytane', () => {
      assert.ok(wynik.czesci.filter((c) => c.cenaWybrana !== null).length > 0);
    });
  });

  describe('pułapka 2: kody ofert mają zmienną kolejność — czytamy PARAMI', () => {
    test('liczba ofert czytana po kodzie „tenders", nie po pozycji', () => {
      const wynik = mapujWynikTed(poNumerze('659388-2026'));
      assert.equal(wynik.czesci[0].liczbaOfert, 5);
      assert.equal(wynik.czesci[0].liczbaOfertMsp, 5);
    });

    test('inna kolejność kodów daje TĘ SAMĄ liczbę ofert', () => {
      const a = ofertyCzesci({
        'received-submissions-type-code': ['tenders', 't-sme', 't-esubm'],
        'received-submissions-type-val': ['7', '3', '7'],
      }, 1, 0);
      const b = ofertyCzesci({
        'received-submissions-type-code': ['t-esubm', 't-sme', 'tenders'],
        'received-submissions-type-val': ['7', '3', '7'],
      }, 1, 0);
      assert.deepEqual(a, b);
      assert.equal(a.liczbaOfert, 7);
      assert.equal(a.liczbaOfertMsp, 3);
    });

    test('kody dzielą się na części blokami — część 2 dostaje swój blok', () => {
      const wynik = ofertyCzesci({
        'received-submissions-type-code': ['tenders', 't-sme', 'tenders', 't-sme'],
        'received-submissions-type-val': ['4', '2', '9', '1'],
      }, 2, 1);
      assert.equal(wynik.liczbaOfert, 9);
      assert.equal(wynik.liczbaOfertMsp, 1);
    });

    test('gdy podział nie wychodzi równo — null, nie liczba z cudzej części', () => {
      const wynik = ofertyCzesci({
        'received-submissions-type-code': ['tenders', 't-sme', 'tenders'],
        'received-submissions-type-val': ['4', '2', '9'],
      }, 2, 0);
      assert.equal(wynik.liczbaOfert, null);
      assert.equal(wynik.liczbaOfertMsp, null);
    });

    test('rozjechane długości code/val = brak danych', () => {
      const wynik = ofertyCzesci({
        'received-submissions-type-code': ['tenders', 't-sme'],
        'received-submissions-type-val': ['4'],
      }, 1, 0);
      assert.equal(wynik.liczbaOfert, null);
    });
  });

  describe('unieważnienie po stronie TED', () => {
    const wynik = mapujWynikTed(poNumerze('659329-2026'));

    test('non-award-justification oznacza część jako unieważnioną', () => {
      assert.equal(wynik.czesci[0].uniewaznione, true);
      assert.equal(wynik.czesci[0].rozstrzygniecie, 'uniewaznienie');
    });

    test('niesie powód („no-rece" = nie złożono ofert)', () => {
      assert.equal(wynik.czesci[0].powodBraku, 'no-rece');
    });

    test('unieważniona część nie ma zwycięzcy ani ceny', () => {
      assert.equal(wynik.czesci[0].zwyciezca, null);
      assert.equal(wynik.czesci[0].cenaWybrana, null);
    });
  });

  describe('wspólny kształt z BZP — benchmark liczy oba rejestry jednym kodem', () => {
    const wynik = mapujWynikTed(poNumerze('659388-2026'));

    test('rodzaj zamówienia w słowniku BZP (Works/Delivery/Services)', () => {
      assert.ok(['Works', 'Delivery', 'Services'].includes(wynik.rodzaj),
        `rodzaj poza słownikiem BZP: ${wynik.rodzaj}`);
      assert.equal(wynik.czesci[0].rodzaj, wynik.rodzaj);
    });

    test('województwo jako dwucyfrowy TERYT, tak jak w BZP', () => {
      assert.match(wynik.wojewodztwo, /^\d{2}$/);
    });

    test('externalId ma prefiks źródła, a źródło jest oznaczone', () => {
      assert.equal(wynik.externalId, 'ted:659388-2026');
      assert.equal(wynik.zrodlo, 'ted');
    });

    test('niesie procedure-identifier jako klucz złączenia z ogłoszeniem', () => {
      assert.ok(wynik.tenderId, 'brak procedure-identifier');
    });

    test('CPV bez duplikatów (TED powtarza kody na poziomie części i ogłoszenia)', () => {
      assert.equal(new Set(wynik.cpv).size, wynik.cpv.length);
    });

    test('ogłoszenie bez numeru publikacji jest odrzucane', () => {
      assert.equal(mapujWynikTed({}), null);
      assert.equal(mapujWynikTed(null), null);
    });
  });

  describe('rabat względem kosztorysu — w TED wolno, w BZP nie', () => {
    test('wartość szacowana części jest czytana (ta sama baza co cena — netto)', () => {
      const wynik = mapujWynikTed(poNumerze('659329-2026'));
      assert.equal(wynik.czesci[0].wartoscSzacowanaNetto, 265953);
    });
  });
});

describe('TED — zmiany umów (form-type = cont-modif)', () => {
  const MODYFIKACJE = fixture('ted-modyfikacje');
  const zmiana = mapujModyfikacjeTed(MODYFIKACJE[0]);

  test('rozpoznaje typ zdarzenia', () => {
    assert.equal(zmiana.typ, 'modyfikacja_umowy');
    assert.equal(zmiana.zrodlo, 'ted');
  });

  test('wskazuje ogłoszenie pierwotne, którego dotyczy zmiana', () => {
    assert.match(zmiana.ogloszeniePierwotne, /^\d+-\d{4}$/);
  });

  test('niesie wartość po zmianie i uzasadnienie', () => {
    assert.ok(zmiana.wartoscPoZmianie > 0);
    assert.ok(zmiana.uzasadnienie.length > 10);
  });

  test('region zamawiającego przez słownik NUTS', () => {
    assert.equal(zmiana.wojewodztwo, '02'); // PL514 = wrocławski → dolnośląskie
  });

  test('wiele umów w jednym ogłoszeniu zostaje listą', () => {
    const wiele = mapujModyfikacjeTed(MODYFIKACJE[1]);
    assert.ok(wiele.umowy.length >= 2);
  });
});
