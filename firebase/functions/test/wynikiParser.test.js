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
 * Próbki pobrane z ŻYWEGO BZP (2026-07-17). Kwot NIE MA w polach JSON —
 * siedzą w `htmlBody`, w ponumerowanych sekcjach ogłoszenia.
 */
describe('parser wyników postępowań (htmlBody z BZP)', () => {
  describe('kwotaZTekstu', () => {
    test('czyta polski format z przecinkiem i spacjami', () => {
      assert.equal(kwotaZTekstu('526741,41 PLN'), 526741.41);
      assert.equal(kwotaZTekstu('2 366 784,88 PLN'), 2366784.88);
      assert.equal(kwotaZTekstu('17000,00 PLN'), 17000);
    });

    test('odrzuca śmieci zamiast zwracać NaN', () => {
      assert.equal(kwotaZTekstu('brak'), null);
      assert.equal(kwotaZTekstu(''), null);
      assert.equal(kwotaZTekstu(null), null);
    });

    test('nie myli numeru sekcji z kwotą', () => {
      assert.equal(kwotaZTekstu('6.2.)'), null);
    });
  });

  describe('roboty budowlane — jedna część', () => {
    const wynik = parsujWynik(fixture('wynik-budowlane'));

    test('wyciąga ceny ofert', () => {
      const [czesc] = wynik.czesci;
      assert.ok(czesc.cenaNajnizsza > 0, 'brak ceny najniższej');
      assert.ok(czesc.cenaNajwyzsza >= czesc.cenaNajnizsza, 'max < min');
      assert.ok(czesc.cenaWybrana > 0, 'brak ceny zwycięzcy');
    });

    test('cena zwycięzcy mieści się między najniższą a najwyższą', () => {
      const [czesc] = wynik.czesci;
      assert.ok(czesc.cenaWybrana >= czesc.cenaNajnizsza);
      assert.ok(czesc.cenaWybrana <= czesc.cenaNajwyzsza);
    });

    test('liczy oferty i oferty od MŚP', () => {
      const [czesc] = wynik.czesci;
      assert.ok(Number.isInteger(czesc.liczbaOfert) && czesc.liczbaOfert > 0);
      assert.ok(czesc.liczbaOfertMsp <= czesc.liczbaOfert, 'MŚP > wszystkich ofert');
    });

    test('niesie CPV i województwo do statystyk regionalnych', () => {
      assert.ok(wynik.cpv.length > 0, 'brak CPV');
      assert.ok(/^\d{8}-\d$/.test(wynik.cpv[0]), `CPV w złym formacie: ${wynik.cpv[0]}`);
      assert.ok(wynik.wojewodztwo, 'brak województwa');
    });

    test('zachowuje identyfikator ogłoszenia', () => {
      assert.match(wynik.externalId, /BZP/);
    });
  });

  describe('ogłoszenie WIELOCZĘŚCIOWE (11 części — pułapka parsera)', () => {
    const wynik = parsujWynik(fixture('wynik-wieloczesciowe'));

    test('rozbija na osobne części, nie skleja w jedną', () => {
      assert.ok(wynik.czesci.length > 1, `oczekiwano wielu części, jest ${wynik.czesci.length}`);
    });

    test('każda część ma własną cenę — nie przepisaną z pierwszej', () => {
      const ceny = wynik.czesci.map((c) => c.cenaWybrana).filter(Boolean);
      assert.ok(ceny.length > 1, 'ceny części nie zostały odczytane');
      assert.ok(new Set(ceny).size > 1, 'wszystkie części mają tę samą cenę — parser sklejył sekcje');
    });
  });

  describe('postępowanie unieważnione', () => {
    const wynik = parsujWynik(fixture('wynik-uniewaznione'));

    test('nie wywala się i nie zmyśla kwot', () => {
      assert.ok(wynik, 'parser zwrócił null zamiast obiektu');
      for (const czesc of wynik.czesci) {
        for (const pole of ['cenaNajnizsza', 'cenaWybrana']) {
          assert.ok(czesc[pole] === null || czesc[pole] > 0, `${pole} = ${czesc[pole]}`);
        }
      }
    });
  });

  describe('spójność kwot (zamawiający wypełniają BZP ręcznie i mylą się)', () => {
    const czesc = (nadpisania) =>
      parsujWynik({
        bzpNumber: '2026/BZP 00000001',
        htmlBody: `<h3>SEKCJA V WYNIK</h3>
          <h3>6.1.) Liczba otrzymanych ofert lub wniosków: <span>3</span></h3>
          <h3>6.2.) Cena lub koszt oferty z najniższą ceną lub kosztem: <span>${nadpisania.min} PLN</span></h3>
          <h3>6.3.) Cena lub koszt oferty z najwyższą ceną lub kosztem: <span>${nadpisania.max} PLN</span></h3>
          <h3>6.4.) Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia: <span>${nadpisania.wybrana} PLN</span></h3>`,
      }).czesci[0];

    test('normalne widełki są spójne', () => {
      assert.equal(czesc({ min: '47970,00', max: '68899,68', wybrana: '47970,00' }).spojne, true);
    });

    test('cena zwycięzcy PONIŻEJ najniższej oferty = dane niespójne', () => {
      // realny przypadek: 2026/BZP 00309687 (widełki 47 970–68 900, zwycięzca 24 900)
      assert.equal(czesc({ min: '47970,00', max: '68899,68', wybrana: '24900,00' }).spojne, false);
    });

    test('cena zwycięzcy POWYŻEJ najwyższej oferty = dane niespójne', () => {
      assert.equal(czesc({ min: '47970,00', max: '68899,68', wybrana: '99000,00' }).spojne, false);
    });

    test('min większe od max = dane niespójne', () => {
      assert.equal(czesc({ min: '68899,68', max: '47970,00', wybrana: '47970,00' }).spojne, false);
    });

    test('niespójna część NADAL niesie dane — odsiewa je dopiero statystyka', () => {
      const c = czesc({ min: '47970,00', max: '68899,68', wybrana: '24900,00' });
      assert.equal(c.liczbaOfert, 3, 'liczba ofert jest wiarygodna niezależnie od kwot');
    });
  });

  describe('odporność', () => {
    test('brak htmlBody nie wywraca parsera', () => {
      const wynik = parsujWynik({ bzpNumber: '2026/BZP 001', htmlBody: null, cpvCode: null });
      assert.equal(wynik.czesci.length, 0);
    });

    test('null zamiast ogłoszenia zwraca null', () => {
      assert.equal(parsujWynik(null), null);
    });
  });
});
