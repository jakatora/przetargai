import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { zbudujUrlWynikow, czyZDoby } from '../src/services/bzp.js';

/*
 * 🚨 REGRESJA, KTÓRA KOSZTOWAŁA CAŁĄ FUNKCJĘ.
 *
 * `pobierzSuroweWynikiDnia` wołało `zapytanieSurowe({ ...oknoDoby(dzien) })`.
 * `oknoDoby` oddaje `{ publishedFrom, publishedTo }`, a `zapytanieSurowe` przyjmowało
 * `{ from, to }` — więc do adresu trafiało dosłowne `PublicationDateFrom=undefined`.
 * BZP odpowiadało HTTP 500 z komunikatem:
 *   „The string 'undefined' was not recognized as a valid DateTime."
 *
 * Skutek: pobieranie WYNIKÓW postępowań z BZP nie zadziałało ANI RAZU od rundy 16.
 * Nie było tego widać, bo job agregacji łapie błąd per doba, agreguje pustą listę
 * i kończy się `ok: true` — „sukces" z zerem danych. Testy jednostkowe wstrzykiwały
 * własny pobieracz doby, więc prawdziwy adres nie był sprawdzany przez nikogo.
 *
 * Ten plik sprawdza ADRES, bo to jedyne miejsce, w którym literówka w nazwie pola
 * przestaje być literówką, a staje się martwą funkcją.
 */
describe('adres zapytania o wyniki BZP', () => {
  const okno = { publishedFrom: '2026-09-23T00:00:00', publishedTo: '2026-09-23T23:59:59' };

  test('niesie PRAWDZIWE daty, a nie „undefined"', () => {
    const url = zbudujUrlWynikow({ noticeType: 'TenderResultNotice', ...okno });
    assert.equal(url.searchParams.get('PublicationDateFrom'), '2026-09-23T00:00:00');
    assert.equal(url.searchParams.get('PublicationDateTo'), '2026-09-23T23:59:59');
    assert.ok(!url.toString().includes('undefined'), `adres zawiera „undefined": ${url}`);
  });

  test('przyjmuje DOKŁADNIE te nazwy pól, które oddaje okno doby', () => {
    /*
     * Asercja na KONTRAKT między funkcjami, nie na kształt obiektu: gdyby któraś
     * strona przemianowała pole, ten test pada, zamiast pozwolić produkcji cicho
     * wysyłać „undefined".
     */
    const zrodlo = readFileSync(new URL('../src/services/bzp.js', import.meta.url), 'utf8');
    const oknoDoby = /function oknoDoby\(dzien\) \{\s*return \{ (\w+): [^,]+, (\w+):/.exec(zrodlo);
    assert.ok(oknoDoby, 'nie znaleziono oknoDoby — zmieniono kształt, zaktualizuj strażnika');
    for (const pole of [oknoDoby[1], oknoDoby[2]]) {
      assert.ok(['publishedFrom', 'publishedTo'].includes(pole),
        `oknoDoby oddaje pole „${pole}", którego zbudujUrlWynikow nie zna`);
    }
  });

  test('bez okna czasu RZUCA, zamiast wysyłać śmieci do rejestru', () => {
    assert.throws(() => zbudujUrlWynikow({ noticeType: 'TenderResultNotice' }), /okna czasu/);
    assert.throws(
      () => zbudujUrlWynikow({ noticeType: 'TenderResultNotice', publishedFrom: '2026-09-23T00:00:00' }),
      /okna czasu/,
    );
  });

  test('sufit strony i filtr województwa trafiają do adresu', () => {
    const url = zbudujUrlWynikow({ noticeType: 'TenderResultNotice', ...okno, province: 'PL14' });
    assert.equal(url.searchParams.get('PageSize'), '500');
    assert.equal(url.searchParams.get('OrganizationProvince'), 'PL14');
  });

  test('bez województwa NIE dokłada pustego filtra', () => {
    const url = zbudujUrlWynikow({ noticeType: 'TenderResultNotice', ...okno });
    assert.equal(url.searchParams.has('OrganizationProvince'), false);
  });
});

/*
 * 🚨 ZMIERZONE NA ŻYWO (2026-09-24): filtr `OrganizationProvince` IGNORUJE górną
 * granicę okna czasu. Zapytanie o dobę 2026-09-23 z `province=PL14` oddało 127
 * ogłoszeń, z czego 11 opublikowano 2026-09-24; na całej dobie było to 104 na 668.
 * Bez odsiania doba „23 września" niosła też ogłoszenia z 24-go, więc kolejna doba
 * zapisywała te same dokumenty po raz drugi: licznik przebiegu kłamał o połowę
 * w górę, a rachunek za zapisy rósł o tyle samo.
 */
describe('doba wyników BZP — odsiewanie ogłoszeń spoza okna', () => {
  test('ogłoszenie z żądanej doby zostaje', () => {
    assert.equal(czyZDoby({ publicationDate: '2026-09-23T06:28:00.31Z' }, '2026-09-23'), true);
  });

  test('ogłoszenie z NASTĘPNEJ doby wypada — przyjdzie przy swojej', () => {
    assert.equal(czyZDoby({ publicationDate: '2026-09-24T01:00:00Z' }, '2026-09-23'), false);
  });

  test('ogłoszenie z POPRZEDNIEJ doby też wypada', () => {
    assert.equal(czyZDoby({ publicationDate: '2026-09-22T23:59:00Z' }, '2026-09-23'), false);
  });

  test('ogłoszenie BEZ daty publikacji zostaje — lepiej raz za dużo niż stracić', () => {
    assert.equal(czyZDoby({}, '2026-09-23'), true);
    assert.equal(czyZDoby({ publicationDate: null }, '2026-09-23'), true);
  });
});
