import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { runBenchmarkRynku } = await import('../src/jobs/benchmarkRynku.js');
const { rozstrzygniecia, benchmarkRynku } = await import('../src/db/repos.js');

const DZIS = Date.UTC(2026, 8, 24);

const czesc = (nadpisania = {}) => ({
  numer: 1, rozstrzygniecie: 'umowa', uniewaznione: false,
  cenaWybrana: null, pozycjaCeny: null, wartoscSzacowanaNetto: null,
  liczbaOfert: null, liczbaOfertMsp: null, wygralMaly: null, spojne: true,
  ...nadpisania,
});

function rozstrzygniecie(numer, { nip, woj = '14', cpv = ['45233140-2'], dzien = '2026-09-10', czesci }) {
  return {
    externalId: `2026/BZP TEST-${numer}`,
    tenderId: `ocds-test-${numer}`,
    zrodlo: 'bzp',
    zamawiajacy: 'URZĄD TESTOWY',
    zamawiajacyNip: nip,
    cpv,
    wojewodztwo: woj,
    opublikowano: dzien,
    czesci,
  };
}

describe('przeliczenie benchmarku z zapisanych rozstrzygnięć', () => {
  test('liczy kubełek zamawiającego i dwa kubełki działu CPV', async () => {
    await rozstrzygniecia.zapiszWiele([
      rozstrzygniecie('a', { nip: '5550001111', czesci: [1, 2, 3].map((n) => czesc({ liczbaOfert: n, cenaWybrana: n * 1000 })) }),
      rozstrzygniecie('b', { nip: '5550001111', czesci: [4, 5, 6].map((n) => czesc({ liczbaOfert: n, cenaWybrana: n * 1000 })) }),
    ]);

    const wynik = await runBenchmarkRynku({ dni: 365, teraz: DZIS });
    assert.equal(wynik.ok, true);
    assert.ok(wynik.rozstrzygniec >= 2);

    const kubelek = await benchmarkRynku.pobierz('nip:5550001111');
    assert.ok(kubelek, 'benchmark zamawiającego nie powstał');
    assert.equal(kubelek.wystarczajacaProbka, true);
    assert.equal(kubelek.oferty.mediana, 3.5);
    assert.equal(kubelek.probka.czesci, 6);

    assert.ok(await benchmarkRynku.pobierz('cpv:45'), 'brak kubełka krajowego');
    assert.ok(await benchmarkRynku.pobierz('cpv:45|14'), 'brak kubełka regionalnego');
  });

  test('kilka kubełków czyta się JEDNYM odczytem wsadowym', async () => {
    const wiele = await benchmarkRynku.pobierzWiele(['nip:5550001111', 'cpv:45', 'cpv:45|14', null, 'nip:nie-ma']);
    assert.equal(Object.keys(wiele).length, 3);
    assert.equal(wiele['nip:nie-ma'], undefined);
  });

  test('pusta lista kluczy nie odpytuje bazy', async () => {
    assert.deepEqual(await benchmarkRynku.pobierzWiele([]), {});
    assert.deepEqual(await benchmarkRynku.pobierzWiele(null), {});
  });

  test('okno czasu odcina stare rozstrzygnięcia', async () => {
    await rozstrzygniecia.zapiszWiele([
      rozstrzygniecie('stare', {
        nip: '5550002222', dzien: '2020-01-01',
        czesci: Array.from({ length: 6 }, () => czesc({ liczbaOfert: 9 })),
      }),
    ]);
    await runBenchmarkRynku({ dni: 30, teraz: DZIS });
    assert.equal(await benchmarkRynku.pobierz('nip:5550002222'), null,
      'rozstrzygnięcie sprzed lat weszło do benchmarku bieżącego okna');
  });

  test('czyta kolekcję STRONAMI — nie ładuje całego rynku do pamięci', async () => {
    const partia = Array.from({ length: 7 }, (_, i) =>
      rozstrzygniecie(`strona-${i}`, { nip: '5550003333', czesci: [czesc({ liczbaOfert: 5 })] }));
    await rozstrzygniecia.zapiszWiele(partia);

    const wynik = await runBenchmarkRynku({ dni: 365, teraz: DZIS, strona: 2 });
    assert.ok(wynik.stron > 1, `oczekiwano wielu stron, było ${wynik.stron}`);
    const kubelek = await benchmarkRynku.pobierz('nip:5550003333');
    assert.equal(kubelek.probka.czesci, 7, 'paginacja zgubiła część rozstrzygnięć');
  });

  test('UTRWALA tylko kubełki z wnioskiem — reszta nie kosztuje zapisu', async () => {
    /*
     * Zmierzone na żywej próbce BZP: 200 ogłoszeń jednego dnia to 178 RÓŻNYCH
     * zamawiających. W rocznym oknie uzbiera się ich dziesiątki tysięcy, a typowy
     * urząd nigdy nie przekroczy progu próbki — zapisywanie ich co dobę zjadłoby
     * darmowy limit Firestore, nie zmieniając ani jednej odpowiedzi.
     */
    await rozstrzygniecia.zapiszWiele([
      rozstrzygniecie('drobny', { nip: '5550004444', czesci: [czesc({ liczbaOfert: 2 })] }),
    ]);
    const wynik = await runBenchmarkRynku({ dni: 365, teraz: DZIS });

    assert.ok(wynik.kubelkow_bez_wniosku >= 1, 'próbka testowa nie ma kubełka bez wniosku');
    assert.equal(wynik.kubelkow + wynik.kubelkow_bez_wniosku, wynik.kubelkow_policzonych);
    assert.equal(await benchmarkRynku.pobierz('nip:5550004444'), null,
      'kubełek bez wniosku został zapisany mimo braku próbki');
    assert.ok(await benchmarkRynku.pobierz('nip:5550001111'), 'kubełek z wnioskiem musi zostać');
  });

  test('sufit odczytów jest ZGŁASZANY, a nie zgadywany z rachunku', async () => {
    const wynik = await runBenchmarkRynku({ dni: 365, teraz: DZIS });
    assert.equal(wynik.uciety_sufit, false, 'próbka testowa nie ma prawa dobić do sufitu');
    const { MAKS_ROZSTRZYGNIEC } = await import('../src/jobs/benchmarkRynku.js');
    assert.ok(MAKS_ROZSTRZYGNIEC > 0);
  });
});
