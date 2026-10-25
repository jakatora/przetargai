import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sprawdzReguly, dolnaGranicaWartosci, WADIUM_MAKS_UDZIAL } from '../src/lib/regulyKarty.js';

const TERAZ = '2026-10-21T10:00:00.000Z';
const ZA_20_DNI = '2026-11-10T10:00:00.000Z';
const USER = {
  keywords: ['dach'], regiony: ['18'], wartosc_max: 1_000_000,
  karta: { wykluczenia: ['drogi'], wartosc_min: 50_000, min_dni_oferta: 5 },
};
const T = (extra) => ({ title: 'Remont dachu szkoły', wojewodztwo: 'podkarpackie', budget: 300_000, deadline: ZA_20_DNI, ...extra });

test('przetarg zgodny z kartą przechodzi', () => {
  assert.equal(sprawdzReguly(USER, T(), TERAZ), null);
});

test('wykluczenie łapie odmianę („drogi” → „dróg”) i ma pierwszeństwo', () => {
  const r = sprawdzReguly(USER, T({ title: 'Przebudowa dróg gminnych', wojewodztwo: 'mazowieckie' }), TERAZ);
  assert.equal(r.przyczyna, 'wykluczenie');
  assert.match(r.szczegol.pl, /drogi/);
});

test('teren: województwo spoza listy (dowolny zapis: nazwa, TERYT, PL-kod)', () => {
  assert.equal(sprawdzReguly(USER, T({ wojewodztwo: 'mazowieckie' }), TERAZ).przyczyna, 'teren');
  assert.equal(sprawdzReguly(USER, T({ wojewodztwo: 'PL14' }), TERAZ).przyczyna, 'teren');
  assert.equal(sprawdzReguly(USER, T({ wojewodztwo: '18' }), TERAZ), null);
});

test('za duże: wartość ponad „do”; bez wartości — z wadium (≤3% wartości)', () => {
  assert.equal(sprawdzReguly(USER, T({ budget: 1_500_000 }), TERAZ).przyczyna, 'za_duze');
  const zWadium = sprawdzReguly(USER, T({ budget: null, wadium_kwota: 45_000 }), TERAZ); // ≥ 1,5 mln
  assert.equal(zWadium.przyczyna, 'za_duze');
  assert.match(zWadium.szczegol.pl, /Wadium/);
  assert.equal(sprawdzReguly(USER, T({ budget: null, wadium_kwota: 10_000 }), TERAZ), null); // ≥ 333 tys. — mieści się
  assert.equal(WADIUM_MAKS_UDZIAL, 0.03);
});

test('za małe: tylko gdy wartość jest znana', () => {
  assert.equal(sprawdzReguly(USER, T({ budget: 20_000 }), TERAZ).przyczyna, 'za_male');
  assert.equal(sprawdzReguly(USER, T({ budget: null }), TERAZ), null);
});

test('termin: mniej dni niż potrzebuje firma', () => {
  assert.equal(sprawdzReguly(USER, T({ deadline: '2026-10-24T10:00:00.000Z' }), TERAZ).przyczyna, 'termin');
  assert.equal(sprawdzReguly(USER, T({ deadline: '2026-10-26T10:00:00.000Z' }), TERAZ), null);
});

test('REVIEW FOCUS 1: brak danych w ogłoszeniu ≠ odrzucenie', () => {
  const bezDanych = { title: 'Remont dachu', wojewodztwo: null, budget: null, wadium_kwota: null, deadline: null };
  assert.equal(sprawdzReguly(USER, bezDanych, TERAZ), null);
  assert.equal(sprawdzReguly(USER, { ...bezDanych, wojewodztwo: 'nieznane miejsce' }, TERAZ), null);
});

test('karta bez reguł (stare konto) niczego nie odrzuca', () => {
  assert.equal(sprawdzReguly({ keywords: ['dach'] }, T({ wojewodztwo: 'mazowieckie', budget: 9e9 }), TERAZ), null);
});

test('dolnaGranicaWartosci', () => {
  assert.deepEqual(dolnaGranicaWartosci({ budget: 100 }), { kwota: 100, zrodlo: 'wartosc', czesci: 1 });
  assert.deepEqual(dolnaGranicaWartosci({ budget: null, wadium_kwota: 3000 }), { kwota: 100_000, zrodlo: 'wadium', czesci: 1 });
  assert.equal(dolnaGranicaWartosci({}), null);
});

test('zamówienie w częściach: granica = średnia część; wadium dla kilku części nie odrzuca (parser zna tylko pierwszą kwotę)', () => {
  // 3 mln w 4 częściach → średnio 750 tys. — mieści się w „do” 1 mln, choć całość nie.
  assert.deepEqual(dolnaGranicaWartosci({ budget: 3_000_000, liczba_czesci: 4 }), { kwota: 750_000, zrodlo: 'wartosc', czesci: 4 });
  assert.equal(sprawdzReguly(USER, T({ budget: 3_000_000, liczba_czesci: 4 }), TERAZ), null);
  const zaDuze = sprawdzReguly(USER, T({ budget: 9_000_000, liczba_czesci: 4 }), TERAZ);
  assert.equal(zaDuze.przyczyna, 'za_duze');
  assert.match(zaDuze.szczegol.pl, /4 częściach, średnio 2\D250\D000 zł na część/); // pl-PL dzieli tysiące twardą spacją
  // Jedna kwota wadium przy 3 częściach: 45 000 / 0,03 / 3 = 500 tys. — mieści się.
  assert.equal(sprawdzReguly(USER, T({ budget: null, wadium_kwota: 45_000, liczba_czesci: 3 }), TERAZ), null);
  const wadiumCzesci = sprawdzReguly(USER, T({ budget: null, wadium_kwota: 150_000, liczba_czesci: 3 }), TERAZ);
  assert.equal(wadiumCzesci.przyczyna, 'za_duze');
  assert.match(wadiumCzesci.szczegol.pl, /przy 3 częściach/);
  // Wadium wymienione osobno dla kilku części — brak wiarygodnej granicy, nie odrzucamy.
  assert.equal(dolnaGranicaWartosci({ budget: null, wadium_kwota: 450_000, wadium_wiele_czesci: true }), null);
  assert.equal(sprawdzReguly(USER, T({ budget: null, wadium_kwota: 450_000, wadium_wiele_czesci: true }), TERAZ), null);
  // liczba_czesci 1/null/śmieć = jak dotąd.
  assert.deepEqual(dolnaGranicaWartosci({ budget: 100, liczba_czesci: 1 }), { kwota: 100, zrodlo: 'wartosc', czesci: 1 });
  assert.deepEqual(dolnaGranicaWartosci({ budget: 100, liczba_czesci: 'x' }), { kwota: 100, zrodlo: 'wartosc', czesci: 1 });
});
