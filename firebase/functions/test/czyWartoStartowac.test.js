import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  kartaStartu, wybierzBenchmark, werdyktZCzynnikow, TON, PROGI, ZASTRZEZENIE,
} from '../src/lib/czyWartoStartowac.js';

const TERAZ = Date.UTC(2026, 8, 24); // 2026-09-24
const za = (dni) => new Date(TERAZ + dni * 86_400_000).toISOString();

function kubelek(nadpisania = {}) {
  return {
    klucz: 'nip:1', wymiar: 'zamawiajacy', etykieta: 'URZĄD', zrodla: ['bzp'],
    probka: { ogloszenia: 20, czesci: 40, od: '2026-01-01', do: '2026-09-01' },
    wystarczajacaProbka: true,
    powodBrakuWniosku: null,
    oferty: { mediana: 5, min: 1, max: 12, n: 40 },
    ofertyMsp: null,
    cena: { mediana: 100_000, min: 50_000, max: 300_000, n: 30 },
    pozycjaCeny: { mediana: 0.1, min: 0, max: 1, n: 25 },
    rabatDoKosztorysu: null,
    uniewaznienia: { czesci: 4, procent: 10 },
    maliWygrywaja: { procent: 60, n: 30 },
    ...nadpisania,
  };
}

const czynnik = (karta, kod) => karta.czynniki.find((c) => c.kod === kod);

describe('karta „czy warto startować" — czego NIE oddaje', () => {
  const karta = kartaStartu({
    tender: { deadline: za(20) }, benchmarki: { zamawiajacy: kubelek() }, teraz: TERAZ,
  });

  test('NIE ma pola z prawdopodobieństwem ani szansą w procentach', () => {
    const tekst = JSON.stringify(karta);
    assert.ok(!/prawdopodobie|szansa|szans[ay]_|procentSzans/i.test(tekst),
      'karta obiecuje prawdopodobieństwo wygranej — to fałszywy pomiar');
    assert.equal(karta.szanse, undefined);
  });

  test('werdykt jest KATEGORIĄ, nie liczbą', () => {
    assert.ok(['sprawdz', 'uwazaj', 'trudny', 'brak_danych', 'po_terminie'].includes(karta.werdykt));
    assert.equal(typeof karta.werdykt, 'string');
  });

  test('zawsze niesie zastrzeżenie, co te liczby znaczą', () => {
    assert.equal(karta.zastrzezenie, ZASTRZEZENIE);
    assert.match(karta.zastrzezenie, /nie prognoza/i);
  });
});

describe('karta — wybór kubełka benchmarku', () => {
  test('zamawiający ma pierwszeństwo, gdy ma dość danych', () => {
    const wybor = wybierzBenchmark({
      zamawiajacy: kubelek(), dzialRegion: kubelek(), dzialKraj: kubelek(),
    });
    assert.equal(wybor.zrodlo, 'zamawiajacy');
  });

  test('gdy zamawiającemu brakuje próbki — schodzimy do działu w regionie', () => {
    const wybor = wybierzBenchmark({
      zamawiajacy: kubelek({ wystarczajacaProbka: false }),
      dzialRegion: kubelek(),
      dzialKraj: kubelek(),
    });
    assert.equal(wybor.zrodlo, 'dzial_region');
  });

  test('gdy i region za wąski — zostaje dział w skali kraju', () => {
    const wybor = wybierzBenchmark({
      zamawiajacy: kubelek({ wystarczajacaProbka: false }),
      dzialRegion: kubelek({ wystarczajacaProbka: false }),
      dzialKraj: kubelek(),
    });
    assert.equal(wybor.zrodlo, 'dzial_kraj');
  });

  test('gdy nigdzie nie ma próbki — brak źródła, nie zmyślony kubełek', () => {
    assert.deepEqual(wybierzBenchmark({}), { zrodlo: null, kubelek: null });
    assert.deepEqual(
      wybierzBenchmark({ zamawiajacy: kubelek({ wystarczajacaProbka: false }) }),
      { zrodlo: null, kubelek: null },
    );
  });

  test('karta mówi, z którego kubełka policzono i na ilu postępowaniach', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) }, benchmarki: { dzialKraj: kubelek() }, teraz: TERAZ,
    });
    assert.equal(karta.zrodloBenchmarku, 'dzial_kraj');
    assert.equal(karta.probka.czesci, 40);
    assert.deepEqual(karta.probka.zrodla, ['bzp']);
  });
});

describe('karta — brak danych to osobny stan, nie „źle"', () => {
  const karta = kartaStartu({ tender: { deadline: za(20) }, benchmarki: {}, teraz: TERAZ });

  test('werdykt to brak_danych, a nie trudny rynek', () => {
    assert.equal(karta.werdykt, 'brak_danych');
    assert.match(karta.naglowek, /Za mało danych/);
  });

  test('czynniki z benchmarku mają ton „nieznany", nie czerwony', () => {
    for (const kod of ['konkurencja', 'uniewaznienia', 'mali_wygrywaja', 'cena_rynkowa']) {
      assert.equal(czynnik(karta, kod).ton, TON.NIEZNANY, `${kod} udaje wiedzę`);
    }
  });

  test('czynniki Z OGŁOSZENIA nadal działają bez benchmarku', () => {
    assert.equal(czynnik(karta, 'czas').ton, TON.ZIELONY);
  });
});

describe('karta — konkurencja', () => {
  const zOfertami = (mediana) => kartaStartu({
    tender: { deadline: za(20) },
    benchmarki: { zamawiajacy: kubelek({ oferty: { mediana, min: 1, max: 20, n: 40 } }) },
    teraz: TERAZ,
  });

  test('mało chętnych = zielony', () => {
    assert.equal(czynnik(zOfertami(PROGI.konkurencjaMala), 'konkurencja').ton, TON.ZIELONY);
  });

  test('tłok = czerwony', () => {
    assert.equal(czynnik(zOfertami(PROGI.konkurencjaDuza), 'konkurencja').ton, TON.CZERWONY);
  });

  test('pomiędzy = żółty', () => {
    assert.equal(czynnik(zOfertami(5), 'konkurencja').ton, TON.ZOLTY);
  });

  test('czynnik niesie liczbę i wielkość próbki, nie samo słowo', () => {
    const c = czynnik(zOfertami(5), 'konkurencja');
    assert.equal(c.wartosc, 5);
    assert.equal(c.probka, 40);
  });
});

describe('karta — unieważnienia i małe firmy', () => {
  test('częste unieważnienia ostrzegają o zmarnowanej pracy', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) },
      benchmarki: { zamawiajacy: kubelek({ uniewaznienia: { czesci: 20, procent: 40 } }) },
      teraz: TERAZ,
    });
    const c = czynnik(karta, 'uniewaznienia');
    assert.equal(c.ton, TON.CZERWONY);
    assert.match(c.szczegol, /marnowana/i);
  });

  test('rynek zdominowany przez dużych jest czerwony dla małej firmy', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) },
      benchmarki: { zamawiajacy: kubelek({ maliWygrywaja: { procent: 5, n: 40 } }) },
      teraz: TERAZ,
    });
    assert.equal(czynnik(karta, 'mali_wygrywaja').ton, TON.CZERWONY);
  });

  test('nieznana wielkość wykonawcy = nieznany, nie 0 %', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) },
      benchmarki: { zamawiajacy: kubelek({ maliWygrywaja: null }) },
      teraz: TERAZ,
    });
    assert.equal(czynnik(karta, 'mali_wygrywaja').ton, TON.NIEZNANY);
  });
});

describe('karta — cena wobec pułapu z profilu', () => {
  test('kontrakt powyżej maksymalnej wartości z profilu = czerwony', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) },
      benchmarki: { zamawiajacy: kubelek() },
      profil: { wartosc_max: 50_000 },
      teraz: TERAZ,
    });
    const c = czynnik(karta, 'cena_rynkowa');
    assert.equal(c.ton, TON.CZERWONY);
    assert.match(c.szczegol, /udźwigniesz/i);
  });

  test('mieści się w pułapie = zielony', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) },
      benchmarki: { zamawiajacy: kubelek() },
      profil: { wartosc_max: 500_000 },
      teraz: TERAZ,
    });
    assert.equal(czynnik(karta, 'cena_rynkowa').ton, TON.ZIELONY);
  });

  test('bez pułapu w profilu — informacja, nie wyrok', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) }, benchmarki: { zamawiajacy: kubelek() }, teraz: TERAZ,
    });
    const c = czynnik(karta, 'cena_rynkowa');
    assert.equal(c.ton, TON.ZOLTY);
    assert.match(c.szczegol, /50000 a 300000/);
  });
});

describe('karta — co tu decyduje', () => {
  test('kryterium z ogłoszenia jest MOCNIEJSZE niż wniosek ze statystyki', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20), kryterium_oceny: 'Cena 60%, Gwarancja 40%' },
      // statystyka mówi „wygrywa najtańszy", ale ogłoszenie mówi inaczej
      benchmarki: { zamawiajacy: kubelek({ pozycjaCeny: { mediana: 0, min: 0, max: 1, n: 30 } }) },
      teraz: TERAZ,
    });
    const c = czynnik(karta, 'co_decyduje');
    assert.equal(c.ton, TON.ZIELONY);
    assert.match(c.naglowek, /nie tylko cena/i);
  });

  test('„cena 100%" rozpoznane jako jedyne kryterium', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20), kryterium_oceny: 'Cena - 100%' },
      benchmarki: { zamawiajacy: kubelek() },
      teraz: TERAZ,
    });
    assert.match(czynnik(karta, 'co_decyduje').naglowek, /wyłącznie cena/i);
  });

  test('bez kryterium sięgamy po pozycję ceny z rozstrzygnięć', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) },
      benchmarki: { zamawiajacy: kubelek({ pozycjaCeny: { mediana: 0.05, min: 0, max: 1, n: 25 } }) },
      teraz: TERAZ,
    });
    const c = czynnik(karta, 'co_decyduje');
    assert.match(c.naglowek, /wygrywa najtańszy/i);
    assert.match(c.szczegol, /nie podaje kryteriów/i);
  });

  test('bez kryterium i bez widełek — nieznany', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20) },
      benchmarki: { zamawiajacy: kubelek({ pozycjaCeny: null }) },
      teraz: TERAZ,
    });
    assert.equal(czynnik(karta, 'co_decyduje').ton, TON.NIEZNANY);
  });
});

describe('karta — czas i wadium pochodzą z OGŁOSZENIA, nie ze statystyki', () => {
  test('termin minął = osobny werdykt, nie „trudny rynek"', () => {
    const karta = kartaStartu({
      tender: { deadline: za(-1) }, benchmarki: { zamawiajacy: kubelek() }, teraz: TERAZ,
    });
    assert.equal(karta.werdykt, 'po_terminie');
    assert.match(czynnik(karta, 'czas').naglowek, /minął/i);
  });

  test('mało czasu = czerwony', () => {
    const karta = kartaStartu({
      tender: { deadline: za(2) }, benchmarki: { zamawiajacy: kubelek() }, teraz: TERAZ,
    });
    assert.equal(czynnik(karta, 'czas').ton, TON.CZERWONY);
  });

  test('brak terminu w ogłoszeniu = nieznany, nie „minął"', () => {
    const karta = kartaStartu({ tender: {}, benchmarki: { zamawiajacy: kubelek() }, teraz: TERAZ });
    assert.equal(czynnik(karta, 'czas').ton, TON.NIEZNANY);
    assert.notEqual(karta.werdykt, 'po_terminie');
  });

  test('wadium wymagane mówi, że trzeba je wnieść PRZED terminem', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20), wadium_wymagane: true, wadium_kwota: 5000 },
      benchmarki: { zamawiajacy: kubelek() }, teraz: TERAZ,
    });
    const c = czynnik(karta, 'wadium');
    assert.match(c.naglowek, /5000/);
    assert.match(c.szczegol, /PRZED/);
  });

  test('brak wadium to realna zaleta dla małej firmy', () => {
    const karta = kartaStartu({
      tender: { deadline: za(20), wadium_wymagane: false },
      benchmarki: { zamawiajacy: kubelek() }, teraz: TERAZ,
    });
    assert.equal(czynnik(karta, 'wadium').ton, TON.ZIELONY);
  });
});

describe('werdykt z tonów', () => {
  const c = (kod, ton, wartosc) => ({ kod, ton, wartosc });

  test('dwa czerwone = trudny rynek', () => {
    assert.equal(werdyktZCzynnikow([
      c('konkurencja', TON.CZERWONY), c('mali_wygrywaja', TON.CZERWONY),
      c('uniewaznienia', TON.ZIELONY), c('cena_rynkowa', TON.ZIELONY),
    ]), 'trudny');
  });

  test('jeden czerwony = uważaj', () => {
    assert.equal(werdyktZCzynnikow([
      c('konkurencja', TON.CZERWONY), c('mali_wygrywaja', TON.ZIELONY),
      c('uniewaznienia', TON.ZIELONY), c('cena_rynkowa', TON.ZIELONY),
    ]), 'uwazaj');
  });

  test('same zielone = sprawdź', () => {
    assert.equal(werdyktZCzynnikow([
      c('konkurencja', TON.ZIELONY), c('mali_wygrywaja', TON.ZIELONY),
      c('uniewaznienia', TON.ZIELONY), c('cena_rynkowa', TON.ZIELONY),
    ]), 'sprawdz');
  });

  test('po terminie bije wszystko — nie ma czego rozważać', () => {
    assert.equal(werdyktZCzynnikow([
      c('czas', TON.CZERWONY, -3),
      c('konkurencja', TON.ZIELONY), c('mali_wygrywaja', TON.ZIELONY),
      c('uniewaznienia', TON.ZIELONY), c('cena_rynkowa', TON.ZIELONY),
    ]), 'po_terminie');
  });

  test('same nieznane z benchmarku = brak danych, choćby ogłoszenie było zielone', () => {
    assert.equal(werdyktZCzynnikow([
      c('czas', TON.ZIELONY, 30), c('wadium', TON.ZIELONY),
      c('konkurencja', TON.NIEZNANY), c('mali_wygrywaja', TON.NIEZNANY),
      c('uniewaznienia', TON.NIEZNANY), c('cena_rynkowa', TON.NIEZNANY),
    ]), 'brak_danych');
  });
});
