import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parsujWynik, kwotaZTekstu } from '../src/lib/wynikiParser.js';

const KATALOG = dirname(fileURLToPath(import.meta.url));
const fixture = (nazwa) =>
  JSON.parse(readFileSync(join(KATALOG, 'fixtures', `${nazwa}.json`), 'utf8'));

/*
 * Etap 6, krok 1 — kompletność ogłoszenia o wyniku.
 *
 * Wszystkie liczby w komentarzach pochodzą z pomiaru na próbce 200 ogłoszeń
 * pobranych z ŻYWEGO BZP (2026-09-22), skrypt `skrypty/pomiar-wynikow.mjs`.
 * Parser R16 czytał z tego ogłoszenia mniej niż połowę tego, co ono niesie.
 */
describe('parser wyników R2 — kompletność ogłoszenia TenderResultNotice', () => {
  describe('kwota bez groszy (9,6 % cen wybranych ginęło bez śladu)', () => {
    test('czyta „9840 PLN" — BZP nie zawsze dopisuje grosze', () => {
      assert.equal(kwotaZTekstu('9840 PLN'), 9840);
      assert.equal(kwotaZTekstu('1 234 567 PLN'), 1234567);
    });

    test('nadal czyta format z groszami', () => {
      assert.equal(kwotaZTekstu('526741,41 PLN'), 526741.41);
      assert.equal(kwotaZTekstu('2 366 784,88 PLN'), 2366784.88);
    });

    test('nadal NIE myli numeru sekcji z kwotą (brak waluty = brak kwoty)', () => {
      assert.equal(kwotaZTekstu('6.2.)'), null);
      assert.equal(kwotaZTekstu('6.4'), null);
    });

    test('ogłoszenie z ceną bez groszy oddaje tę cenę, nie null', () => {
      const wynik = parsujWynik(fixture('wynik-bez-groszy'));
      const zCena = wynik.czesci.filter((c) => c.cenaWybrana !== null);
      assert.ok(zCena.length > 0, 'żadna część nie ma ceny wybranej');
      assert.ok(Number.isInteger(zCena[0].cenaWybrana), `oczekiwano pełnych złotych: ${zCena[0].cenaWybrana}`);
    });
  });

  describe('podział na części — blok-widmo przesuwał numerację o 1', () => {
    const wynik = parsujWynik(fixture('wynik-czesci-mieszane'));

    test('liczy tylko bloki niosące 5.1.) — 200/200 ogłoszeń zgodnych z procedureResult', () => {
      const niepuste = String(fixture('wynik-czesci-mieszane').procedureResult).split(';').filter(Boolean);
      assert.equal(wynik.czesci.length, niepuste.length);
    });

    test('numer części pochodzi z ogłoszenia, nie z kolejności bloku', () => {
      // 2026/BZP 00448927: części 4, 13, 17, 19, 20 nie zostały rozstrzygnięte
      const numery = wynik.czesci.map((c) => c.numer);
      assert.deepEqual(numery, [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18]);
    });

    test('numeracja nie jest ciągła — luka to część bez rozstrzygnięcia', () => {
      assert.ok(!wynik.czesci.some((c) => c.numer === 4), 'część 4 nie ma bloku wyniku');
    });
  });

  describe('rozstrzygnięcie per część (27,5 % części to unieważnienia)', () => {
    test('część z umową ma rozstrzygniecie „umowa"', () => {
      const wynik = parsujWynik(fixture('wynik-czesci-mieszane'));
      assert.equal(wynik.czesci[0].rozstrzygniecie, 'umowa');
      assert.equal(wynik.czesci[0].uniewaznione, false);
    });

    test('unieważnienie jest widoczne jako osobny stan, nie jako brak danych', () => {
      const wynik = parsujWynik(fixture('wynik-uniewaznione'));
      const uniewaznione = wynik.czesci.filter((c) => c.uniewaznione);
      assert.ok(uniewaznione.length > 0, 'fixture unieważnienia nie ma ani jednej części unieważnionej');
      assert.equal(uniewaznione[0].rozstrzygniecie, 'uniewaznienie');
      assert.equal(uniewaznione[0].zwyciezca, null, 'unieważniona część nie ma zwycięzcy');
    });
  });

  describe('zwycięzca — indeksowany NUMEREM części, nie kolejnością bloku', () => {
    const wynik = parsujWynik(fixture('wynik-czesci-mieszane'));

    test('każda rozstrzygnięta część niesie nazwę zwycięzcy', () => {
      const zUmowa = wynik.czesci.filter((c) => c.rozstrzygniecie === 'umowa');
      assert.ok(zUmowa.every((c) => c.zwyciezca?.nazwa), 'część z umową bez zwycięzcy');
    });

    test('część 6 ma swojego zwycięzcę, nie zwycięzcę szóstego bloku', () => {
      // contractors[] indeksuje NUMER części: contractors[5] = część 6.
      // Zipowanie po kolejności bloku (6. blok = część 7) podstawiło cudzą firmę.
      const czesc6 = wynik.czesci.find((c) => c.numer === 6);
      assert.equal(czesc6.zwyciezca.nazwa, 'BIONOVO Aneta Ludwig');
    });

    test('zwycięzca niesie NIP i miasto — to podstawa benchmarku zamawiającego', () => {
      const z = wynik.czesci.find((c) => c.zwyciezca)?.zwyciezca;
      assert.ok(z.nip, 'brak NIP zwycięzcy');
      assert.ok(z.miasto, 'brak miasta zwycięzcy');
    });
  });

  describe('wartość szacowana (art. 28 Pzp — NETTO, inna baza niż cena oferty)', () => {
    test('ogłoszenie niesie wartość z 4.3 jako wartość NETTO', () => {
      const wynik = parsujWynik(fixture('wynik-czesci-mieszane'));
      assert.ok(wynik.wartoscSzacowanaNetto === null || wynik.wartoscSzacowanaNetto > 0);
    });

    test('część z 4.5.5 niesie własną wartość szacowaną', () => {
      const wynik = parsujWynik({
        bzpNumber: '2026/BZP 00000002',
        procedureResult: 'zawarcieUmowy;zawarcieUmowy',
        htmlBody: `SEKCJA IV – PRZEDMIOT ZAMÓWIENIA 4.3.) Wartość zamówienia: 327600,00 PLN
          Część 1 4.5.5.) Wartość części: 109200,00 PLN
          Część 2 4.5.5.) Wartość części: 218400,00 PLN
          SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA (dla części 1) 5.1.) Postępowanie zakończyło się: umowa
          6.4.) Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia: 92127,00 PLN
          SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA (dla części 2) 5.1.) Postępowanie zakończyło się: umowa
          6.4.) Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia: 200000,00 PLN`,
      });
      assert.equal(wynik.wartoscSzacowanaNetto, 327600);
      assert.equal(wynik.czesci[0].wartoscSzacowanaNetto, 109200);
      assert.equal(wynik.czesci[1].wartoscSzacowanaNetto, 218400);
    });

    test('NIE liczy rabatu z 4.5.5 vs 6.4 — to różne bazy (netto vs brutto)', () => {
      const wynik = parsujWynik({
        bzpNumber: '2026/BZP 00000003',
        procedureResult: 'zawarcieUmowy',
        htmlBody: `SEKCJA IV 4.3.) Wartość zamówienia: 100000,00 PLN
          SEKCJA V (dla części 1) 5.1.) x: umowa
          6.4.) Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia: 123000,00 PLN`,
      });
      assert.equal(wynik.czesci[0].rabatDoSzacunku, undefined,
        'rabat względem wartości szacowanej dla BZP jest zakazany — mediana 1,0489 to VAT, nie drożyzna');
    });
  });

  describe('pozycja ceny wewnątrz konkursu ofert (jedyne porównanie w tej samej bazie)', () => {
    const czesc = (min, max, wybrana) =>
      parsujWynik({
        bzpNumber: '2026/BZP 00000004',
        procedureResult: 'zawarcieUmowy',
        htmlBody: `SEKCJA V (dla części 1) 5.1.) x: umowa
          6.2.) Cena lub koszt oferty z najniższą ceną lub kosztem: ${min} PLN
          6.3.) Cena lub koszt oferty z najwyższą ceną lub kosztem: ${max} PLN
          6.4.) Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia: ${wybrana} PLN`,
      }).czesci[0];

    test('wygrana najtańszą ofertą = pozycja 0', () => {
      assert.equal(czesc('100,00', '200,00', '100,00').pozycjaCeny, 0);
    });

    test('wygrana najdroższą ofertą = pozycja 1 (jakość przebiła cenę)', () => {
      assert.equal(czesc('100,00', '200,00', '200,00').pozycjaCeny, 1);
    });

    test('środek widełek = 0,5', () => {
      assert.equal(czesc('100,00', '200,00', '150,00').pozycjaCeny, 0.5);
    });

    test('jedna oferta (min = max) nie daje pozycji — dzielenie przez zero', () => {
      assert.equal(czesc('100,00', '100,00', '100,00').pozycjaCeny, null);
    });

    test('dane niespójne nie dają pozycji', () => {
      assert.equal(czesc('100,00', '200,00', '50,00').pozycjaCeny, null);
    });
  });

  describe('powiązanie z ogłoszeniem o zamówieniu', () => {
    test('niesie identyfikator postępowania (ocds) — klucz złączenia', () => {
      const wynik = parsujWynik(fixture('wynik-bez-groszy'));
      assert.match(wynik.tenderId, /^ocds-/);
    });

    test('niesie NIP zamawiającego — klucz benchmarku per zamawiający', () => {
      const wynik = parsujWynik(fixture('wynik-bez-groszy'));
      assert.match(wynik.zamawiajacyNip, /^\d+$/);
    });
  });

  describe('odporność', () => {
    test('brak procedureResult nie kasuje części (stare ogłoszenia)', () => {
      const wynik = parsujWynik({
        bzpNumber: '2026/BZP 00000005',
        htmlBody: 'SEKCJA V (dla części 1) 5.1.) x: umowa 6.1.) Liczba otrzymanych ofert lub wniosków: 3',
      });
      assert.equal(wynik.czesci.length, 1);
      assert.equal(wynik.czesci[0].rozstrzygniecie, null);
      assert.equal(wynik.czesci[0].uniewaznione, false);
    });

    test('nagłówek SEKCJA V bez 5.1.) nie tworzy części-widma', () => {
      const wynik = parsujWynik({
        bzpNumber: '2026/BZP 00000006',
        procedureResult: 'zawarcieUmowy',
        htmlBody: `SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA Część 1
          SEKCJA V ZAKOŃCZENIE POSTĘPOWANIA (dla części 1) 5.1.) x: umowa
          6.4.) Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia: 500 PLN`,
      });
      assert.equal(wynik.czesci.length, 1);
      assert.equal(wynik.czesci[0].numer, 1);
    });

    test('encje HTML w nazwie zwycięzcy są rozkodowane', () => {
      const wynik = parsujWynik({
        bzpNumber: '2026/BZP 00000007',
        procedureResult: 'zawarcieUmowy',
        htmlBody: `SEKCJA V (dla części 1) 5.1.) x: umowa
          7.3.1) Nazwa (firma) wykonawcy, któremu udzielono zamówienia: FIRMA &#34;ABC&#34; Sp. z o.o.
          7.3.2) Krajowy Numer Identyfikacyjny: 1234567890`,
      });
      assert.equal(wynik.czesci[0].zwyciezca.nazwa, 'FIRMA "ABC" Sp. z o.o.');
    });
  });
});
