import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  zbudujBenchmark, benchmarkZamawiajacych, benchmarkDzialowCpv,
  kluczZamawiajacego, kluczDzialuCpv, kluczDzialuCpvKraj, rabatCzesci,
  MIN_PROBKA,
} from '../src/lib/benchmark.js';

/** Rozstrzygnięcie w kształcie, w jakim oddaje je parser BZP. */
function wynikBzp({ nip = '1234567890', woj = '14', cpv = ['45233140-2'], dzien = '2026-09-01', czesci }) {
  return {
    externalId: `2026/BZP ${nip}-${dzien}`,
    zrodlo: 'bzp',
    zamawiajacy: 'URZĄD MIASTA',
    zamawiajacyNip: nip,
    cpv,
    wojewodztwo: woj,
    opublikowano: dzien,
    czesci,
  };
}

const czesc = (nadpisania = {}) => ({
  numer: 1, rozstrzygniecie: 'umowa', uniewaznione: false,
  cenaNajnizsza: null, cenaNajwyzsza: null, cenaWybrana: null,
  pozycjaCeny: null, wartoscSzacowanaNetto: null,
  liczbaOfert: null, liczbaOfertMsp: null, wygralMaly: null,
  spojne: true, ...nadpisania,
});

const pieciuCzesci = (nadpisania) => Array.from({ length: 5 }, () => czesc(nadpisania));

describe('benchmark — próbka decyduje, czy wolno cokolwiek powiedzieć', () => {
  test('poniżej progu NIE oddaje mediany, tylko jawny powód', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({ czesci: [czesc({ liczbaOfert: 3 }), czesc({ liczbaOfert: 4 })] }),
    ]);
    const kubelek = b['nip:1234567890'];
    assert.equal(kubelek.wystarczajacaProbka, false);
    assert.equal(kubelek.oferty, null, 'mediana z dwóch części to anegdota, nie statystyka');
    assert.match(kubelek.powodBrakuWniosku, /probka_2_z_5/);
  });

  test('kubełek z za małą próbką NADAL istnieje — ekran ma pokazać „za mało danych"', () => {
    const b = benchmarkZamawiajacych([wynikBzp({ czesci: [czesc({ liczbaOfert: 3 })] })]);
    assert.ok(b['nip:1234567890'], 'kubełek zniknął — ekran pokaże pustkę zamiast powodu');
    assert.equal(b['nip:1234567890'].probka.czesci, 1);
  });

  test('od progu oddaje medianę liczby ofert', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({ czesci: [1, 2, 3, 9, 10].map((n) => czesc({ liczbaOfert: n })) }),
    ]);
    const kubelek = b['nip:1234567890'];
    assert.equal(kubelek.wystarczajacaProbka, true);
    assert.equal(kubelek.oferty.mediana, 3);
    assert.equal(kubelek.oferty.n, 5);
  });

  test('próg to stała, nie magiczna liczba rozsypana po kodzie', () => {
    assert.equal(MIN_PROBKA, 5);
  });

  test('widełki cenowe wymagają WŁASNEJ minimalnej próbki cen', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({
        czesci: [
          czesc({ liczbaOfert: 2, cenaWybrana: 1000 }),
          czesc({ liczbaOfert: 2, cenaWybrana: 2000 }),
          czesc({ liczbaOfert: 2 }), czesc({ liczbaOfert: 2 }), czesc({ liczbaOfert: 2 }),
        ],
      }),
    ]);
    assert.equal(b['nip:1234567890'].cena, null, 'dwie ceny to za mało na widełki');
  });
});

describe('benchmark — ceny wchodzą tylko z części SPÓJNYCH', () => {
  test('część z kwotami sprzecznymi nie zanieża mediany', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({
        czesci: [
          czesc({ cenaWybrana: 100_000 }), czesc({ cenaWybrana: 100_000 }),
          czesc({ cenaWybrana: 100_000 }), czesc({ cenaWybrana: 100_000 }),
          // zamawiający wpisał cenę poniżej najniższej oferty — parser oznaczył to
          czesc({ cenaWybrana: 1, spojne: false }),
        ],
      }),
    ]);
    const cena = b['nip:1234567890'].cena;
    assert.equal(cena.n, 4);
    assert.equal(cena.min, 100_000, 'niespójna kwota weszła do statystyki cen');
  });

  test('liczba ofert z niespójnej części JEST wiarygodna i wchodzi', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({ czesci: pieciuCzesci({ liczbaOfert: 7, cenaWybrana: 5, spojne: false }) }),
    ]);
    assert.equal(b['nip:1234567890'].oferty.mediana, 7);
    assert.equal(b['nip:1234567890'].cena, null);
  });
});

describe('benchmark — rabat względem kosztorysu TYLKO tam, gdzie ta sama baza', () => {
  test('BZP: rabatu NIE ma — 4.3 jest netto, a 6.4 brutto', () => {
    const czescZObiema = czesc({ cenaWybrana: 123_000, wartoscSzacowanaNetto: 100_000 });
    assert.equal(rabatCzesci({ zrodlo: 'bzp' }, czescZObiema), null);

    const b = benchmarkZamawiajacych([wynikBzp({ czesci: Array.from({ length: 5 }, () => czescZObiema) })]);
    assert.equal(b['nip:1234567890'].rabatDoKosztorysu, null);
  });

  test('TED: rabat JEST liczony — obie liczby to eForms netto', () => {
    const czescTed = czesc({ cenaWybrana: 90_000, wartoscSzacowanaNetto: 100_000 });
    assert.equal(rabatCzesci({ zrodlo: 'ted' }, czescTed), 10);
  });

  test('TED: cena powyżej kosztorysu daje rabat ujemny, nie zero', () => {
    assert.equal(rabatCzesci({ zrodlo: 'ted' }, czesc({ cenaWybrana: 110_000, wartoscSzacowanaNetto: 100_000 })), -10);
  });

  test('kosztorys zerowy lub brakujący nie daje dzielenia przez zero', () => {
    assert.equal(rabatCzesci({ zrodlo: 'ted' }, czesc({ cenaWybrana: 10, wartoscSzacowanaNetto: 0 })), null);
    assert.equal(rabatCzesci({ zrodlo: 'ted' }, czesc({ cenaWybrana: 10 })), null);
  });
});

describe('benchmark — unieważnienia są faktem o rynku, nie brakiem danych', () => {
  test('odsetek unieważnień liczy się z WSZYSTKICH części', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({
        czesci: [
          czesc({ uniewaznione: true, rozstrzygniecie: 'uniewaznienie' }),
          czesc({ uniewaznione: true, rozstrzygniecie: 'uniewaznienie' }),
          czesc({ cenaWybrana: 100 }), czesc({ cenaWybrana: 100 }), czesc({ cenaWybrana: 100 }),
        ],
      }),
    ]);
    assert.equal(b['nip:1234567890'].uniewaznienia.czesci, 2);
    assert.equal(b['nip:1234567890'].uniewaznienia.procent, 40);
  });

  test('odsetek podawany jest też przy małej próbce — to fakt, nie prognoza', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({ czesci: [czesc({ uniewaznione: true }), czesc()] }),
    ]);
    assert.equal(b['nip:1234567890'].wystarczajacaProbka, false);
    assert.equal(b['nip:1234567890'].uniewaznienia.procent, 50);
  });
});

describe('benchmark — grupowanie po NIP-ie, nie po nazwie', () => {
  test('dwie pisownie tej samej jednostki to JEDEN kubełek', () => {
    const b = benchmarkZamawiajacych([
      { ...wynikBzp({ czesci: pieciuCzesci({ liczbaOfert: 2 }) }), zamawiajacy: 'SĄD REJONOWY W RZESZOWIE' },
      { ...wynikBzp({ czesci: pieciuCzesci({ liczbaOfert: 8 }) }), zamawiajacy: 'Sąd Rejonowy w Rzeszowie' },
    ]);
    assert.equal(Object.keys(b).length, 1);
    assert.equal(b['nip:1234567890'].probka.czesci, 10);
  });

  test('rozstrzygnięcie bez NIP-u nie trafia do żadnego kubełka zamawiającego', () => {
    assert.equal(kluczZamawiajacego({ zamawiajacy: 'Ktoś' }), null);
    assert.deepEqual(benchmarkZamawiajacych([{ zamawiajacy: 'Ktoś', czesci: [czesc()] }]), {});
  });

  test('czyta NIP także z denormalizowanego pola z Firestore', () => {
    assert.equal(kluczZamawiajacego({ zamawiajacy_nip: '999' }), 'nip:999');
  });
});

describe('benchmark — dział CPV: region i kraj to OSOBNE kubełki', () => {
  test('klucz regionalny wymaga województwa, inaczej zderzyłby się z krajowym', () => {
    assert.equal(kluczDzialuCpv({ cpv: ['45233140-2'], wojewodztwo: '14' }), 'cpv:45|14');
    assert.equal(kluczDzialuCpv({ cpv: ['45233140-2'] }), null);
    assert.equal(kluczDzialuCpvKraj({ cpv: ['45233140-2'] }), 'cpv:45');
  });

  test('rozstrzygnięcie bez regionu NIE nadpisuje kubełka krajowego', () => {
    const b = benchmarkDzialowCpv([
      wynikBzp({ woj: '14', czesci: pieciuCzesci({ liczbaOfert: 3 }) }),
      wynikBzp({ woj: null, czesci: pieciuCzesci({ liczbaOfert: 11 }) }),
    ]);
    assert.equal(b['cpv:45'].probka.czesci, 10, 'kubełek krajowy stracił dane regionu');
    assert.equal(b['cpv:45|14'].probka.czesci, 5);
  });

  test('CPV z TED (bez cyfry kontrolnej) trafia do tego samego działu co BZP', () => {
    assert.equal(kluczDzialuCpvKraj({ cpv: ['45215140'] }), 'cpv:45');
    assert.equal(kluczDzialuCpvKraj({ cpv: ['45215140-2'] }), 'cpv:45');
  });
});

describe('benchmark — uczciwość metryczki', () => {
  const b = benchmarkZamawiajacych([
    wynikBzp({ dzien: '2026-07-01', czesci: pieciuCzesci({ liczbaOfert: 3, wygralMaly: true }) }),
    { ...wynikBzp({ dzien: '2026-09-20', czesci: pieciuCzesci({ liczbaOfert: 4, wygralMaly: false }) }), zrodlo: 'ted' },
  ]);
  const kubelek = b['nip:1234567890'];

  test('niesie zakres dat, z których policzono', () => {
    assert.equal(kubelek.probka.od, '2026-07-01');
    assert.equal(kubelek.probka.do, '2026-09-20');
  });

  test('niesie liczbę ogłoszeń i części osobno', () => {
    assert.equal(kubelek.probka.ogloszenia, 2);
    assert.equal(kubelek.probka.czesci, 10);
  });

  test('niesie rejestry, z których powstała próbka', () => {
    assert.deepEqual(kubelek.zrodla, ['bzp', 'ted']);
  });

  test('odsetek wygranych małych firm liczy się z części, gdzie to WIADOMO', () => {
    assert.equal(kubelek.maliWygrywaja.procent, 50);
    assert.equal(kubelek.maliWygrywaja.n, 10);
  });

  test('gdy wielkość firmy nieznana — null, a nie 0 %', () => {
    const bezWielkosci = benchmarkZamawiajacych([wynikBzp({ czesci: pieciuCzesci({ liczbaOfert: 2 }) })]);
    assert.equal(bezWielkosci['nip:1234567890'].maliWygrywaja, null);
  });
});

describe('benchmark — pozycja ceny mówi, czy tu wygrywa najtańszy', () => {
  test('mediana pozycji blisko zera = wygrywa cena', () => {
    const b = benchmarkZamawiajacych([
      wynikBzp({ czesci: pieciuCzesci({ liczbaOfert: 5, pozycjaCeny: 0 }) }),
    ]);
    assert.equal(b['nip:1234567890'].pozycjaCeny.mediana, 0);
  });

  test('brak widełek = brak pozycji, nie zero', () => {
    const b = benchmarkZamawiajacych([wynikBzp({ czesci: pieciuCzesci({ liczbaOfert: 5 }) })]);
    assert.equal(b['nip:1234567890'].pozycjaCeny, null);
  });
});

describe('benchmark — odporność', () => {
  test('pusta lista daje pusty wynik, nie wyjątek', () => {
    assert.deepEqual(zbudujBenchmark([], { klucz: kluczZamawiajacego, wymiar: 'x' }), {});
    assert.deepEqual(zbudujBenchmark(null, { klucz: kluczZamawiajacego, wymiar: 'x' }), {});
  });

  test('rozstrzygnięcie bez części nie wywraca agregacji', () => {
    const b = benchmarkZamawiajacych([{ zamawiajacyNip: '1', zamawiajacy: 'X' }]);
    assert.equal(b['nip:1'].probka.czesci, 0);
    assert.equal(b['nip:1'].uniewaznienia.procent, null);
  });
});
