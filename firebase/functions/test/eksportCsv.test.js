import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  doCsv, komorka, wierszZapisanego, wierszKatalogu, KOLUMNY_ZAPISANYCH, KOLUMNY_KATALOGU,
  nazwaPliku, BOM, MAKS_WIERSZY_KATALOGU,
} from '../src/lib/eksportCsv.js';

describe('komórka CSV', () => {
  test('średnik, cudzysłów i nowa linia → w cudzysłowie, cudzysłów podwojony', () => {
    assert.equal(komorka('a;b'), '"a;b"');
    assert.equal(komorka('Gmina "Nowa"'), '"Gmina ""Nowa"""');
    assert.equal(komorka('linia1\nlinia2'), '"linia1\nlinia2"');
    assert.equal(komorka('zwykły tekst'), 'zwykły tekst');
  });

  test('ochrona przed wstrzyknięciem formuł (=, +, -, @, tab, CR)', () => {
    // Tytuł ogłoszenia pochodzi z rejestru publicznego, czyli od OBCEJ osoby.
    // Excel wykonałby „=HYPERLINK(...)" jako formułę po otwarciu pliku.
    assert.equal(komorka('=HYPERLINK("http://zly")'), `"'=HYPERLINK(""http://zly"")"`);
    assert.equal(komorka('+48 123'), "'+48 123");
    assert.equal(komorka('-5'), "'-5");
    assert.equal(komorka('@SUMA(A1)'), "'@SUMA(A1)");
    assert.equal(komorka('\tukryte'), "'\tukryte");
  });

  test('liczby z przecinkiem dziesiętnym (polski Excel), puste wartości puste', () => {
    assert.equal(komorka(1250000.5), '1250000,5');
    assert.equal(komorka(-3), '-3', 'liczba ujemna to liczba, nie formuła');
    assert.equal(komorka(null), '');
    assert.equal(komorka(undefined), '');
  });
});

describe('dokument CSV', () => {
  test('BOM UTF-8, nagłówek, CRLF, separator średnik', () => {
    const csv = doCsv([{ a: 'x', b: 2 }], [{ klucz: 'a', naglowek: 'Kolumna A' }, { klucz: 'b', naglowek: 'B' }]);
    assert.ok(csv.startsWith(BOM), 'bez BOM Excel psuje polskie znaki');
    assert.equal(csv, `${BOM}Kolumna A;B\r\nx;2\r\n`);
  });

  test('pusta lista → sam nagłówek', () => {
    assert.equal(doCsv([], [{ klucz: 'a', naglowek: 'A' }]), `${BOM}A\r\n`);
  });
});

describe('wiersze', () => {
  test('zapisany przetarg: etap po polsku, daty bez strefy, notatka', () => {
    const w = wierszZapisanego({
      tender_id: 'X1',
      tender_title: 'Remont drogi',
      tender_organization: 'Gmina',
      tender_deadline: '2026-10-05T08:00:00.000Z',
      tender_budget: 1500000,
      tender_currency: 'PLN',
      tender_source: 'bzp',
      tender_cpv: '45233140-2',
      tender_url: 'https://ezamowienia.gov.pl/x',
      status: 'przygotowuje',
      notatka: 'zadzwonić do kierownika',
      saved_at: '2026-09-20T10:00:00.000Z',
    });
    assert.equal(w.etap, 'Przygotowuję ofertę');
    assert.equal(w.termin, '2026-10-05 10:00', 'czas polski, nie UTC');
    assert.equal(w.zrodlo, 'BZP');
    assert.equal(w.notatka, 'zadzwonić do kierownika');
    for (const k of KOLUMNY_ZAPISANYCH) assert.ok(k.klucz in w, k.klucz);
  });

  test('brak statusu = domyślny „Rozważam"', () => {
    assert.equal(wierszZapisanego({ tender_title: 'x' }).etap, 'Rozważam');
  });

  test('przetarg z katalogu', () => {
    const w = wierszKatalogu({
      id: 'T1', title: 'Dostawa', organization: 'Szpital', deadline: '2026-12-01T11:00:00.000Z',
      budget: null, source: 'baza_konkurencyjnosci', cpv_main: '33000000', wojewodztwo: 'PL14',
      published_at: '2026-09-23T00:00:00.000Z', url: 'https://bk',
    });
    assert.equal(w.zrodlo, 'Baza Konkurencyjności');
    assert.equal(w.wojewodztwo, 'Mazowieckie');
    assert.equal(w.wartosc, null);
    assert.equal(w.termin, '2026-12-01 12:00');
    for (const k of KOLUMNY_KATALOGU) assert.ok(k.klucz in w, k.klucz);
  });

  test('nazwa pliku z datą, sufit katalogu', () => {
    assert.equal(nazwaPliku('zapisane', '2026-09-24T10:00:00Z'), 'przetargai-zapisane-2026-09-24.csv');
    assert.equal(MAKS_WIERSZY_KATALOGU, 500);
  });
});
