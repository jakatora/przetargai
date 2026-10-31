import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klasaCpv } from '../src/lib/wynikiAgregacja.js';
import { benchmarkKlasCpv, kluczKlasyCpv, kluczKlasyCpvKraj } from '../src/lib/benchmark.js';
import { kluczePartnerow, wybierzPartnerow, MIN_PARTNEROW } from '../src/lib/partnerzy.js';

test('klasa CPV: cztery cyfry; kod tylko do działu albo grupy nie ma klasy', () => {
  assert.equal(klasaCpv('45233120-6'), '4523');
  assert.equal(klasaCpv(['45233140', '45111200']), '4523');
  assert.equal(klasaCpv('45000000-7'), null);
  assert.equal(klasaCpv('45200000-9'), null);
  assert.equal(klasaCpv(null), null);
});

test('kubełki klasy CPV: w województwie i w kraju; bez województwa tylko krajowy', () => {
  const wynik = (n, woj, nip) => ({
    externalId: `w${n}`, zrodlo: 'bzp', cpv: ['45233140-2'], wojewodztwo: woj, opublikowano: `2026-10-0${n}`,
    czesci: [{ numer: 1, uniewaznione: false, spojne: true, cenaWybrana: 100_000, liczbaOfert: 3, zwyciezca: { nazwa: `Firma ${nip}`, nip } }],
  });
  assert.equal(kluczKlasyCpv(wynik(1, '18', '1')), 'cpvk:4523|18');
  assert.equal(kluczKlasyCpvKraj(wynik(1, null, '1')), 'cpvk:4523');
  assert.equal(kluczKlasyCpv(wynik(1, null, '1')), null);
  const b = benchmarkKlasCpv([1, 2, 3, 4, 5].map((n) => wynik(n, n < 5 ? '18' : null, String(1000000000 + (n % 3)))));
  assert.equal(b['cpvk:4523'].wymiar, 'klasa_cpv_kraj');
  assert.equal(b['cpvk:4523'].probka.czesci, 5);
  assert.equal(b['cpvk:4523|18'].probka.czesci, 4);
  assert.equal(b['cpvk:4523'].najczestsiZwyciezcy.length, 3);
});

const kubelek = (firmy, wystarczajacaProbka = true) => ({
  wystarczajacaProbka,
  probka: { ogloszenia: 12, czesci: 14, od: '2025-11-01', do: '2026-10-30' },
  najczestsiZwyciezcy: firmy.map((nip, i) => ({ nazwa: `Firma ${nip}`, nip, wygrane: 9 - i, ogloszen: 8 - i, wartosc: 1_000_000 - i, ostatnio: '2026-10-01' })),
});

test('partnerzy: klasa w regionie, gdy ma ≥3 firmy bez własnej; inaczej klasa w kraju, potem dział w regionie', () => {
  const tender = { cpv_main: '45233120-6', wojewodztwo: 'PL18' };
  const klucze = kluczePartnerow(tender);
  assert.deepEqual(klucze.map((k) => k.klucz), ['cpvk:4523|18', 'cpvk:4523', 'cpv:45|18']);

  // Region ma 3 firmy, ale jedna to użytkownik → za mało; kraj wystarcza.
  const kubelki = {
    'cpvk:4523|18': kubelek(['1111111111', '2222222222', '5555555555']),
    'cpvk:4523': kubelek(['1111111111', '2222222222', '3333333333', '4444444444']),
  };
  const w = wybierzPartnerow({ klucze, kubelki, wlasnyNip: '555-555-55-55' });
  assert.equal(w.dostepne, true);
  assert.equal(w.zakres.poziom, 'klasa_kraj');
  assert.equal(w.zakres.region, false);
  assert.equal(w.partnerzy.length, 4);
  assert.deepEqual(Object.keys(w.partnerzy[0]).sort(), ['nazwa', 'nip', 'ogloszen', 'ostatnio', 'wartosc', 'wygrane']);
  assert.ok(w.zakres.branza.length > 3);

  const region = wybierzPartnerow({ klucze, kubelki, wlasnyNip: null });
  assert.equal(region.zakres.poziom, 'klasa_region');
  assert.equal(region.partnerzy.length, MIN_PARTNEROW);
});

test('partnerzy: kubełek z małą próbką pominięty; brak CPV i brak danych mają powód', () => {
  const klucze = kluczePartnerow({ cpv_main: '45233120-6', wojewodztwo: '18' });
  const dzial = wybierzPartnerow({ klucze, kubelki: { 'cpvk:4523|18': kubelek(['1', '2', '3'], false), 'cpv:45|18': kubelek(['7777777777', '8888888888', '9999999999']) } });
  assert.equal(dzial.zakres.poziom, 'dzial_region');
  assert.deepEqual(wybierzPartnerow({ klucze: kluczePartnerow({ title: 'bez CPV' }) }), { dostepne: false, powod: 'brak_cpv', partnerzy: [] });
  assert.equal(wybierzPartnerow({ klucze, kubelki: {} }).powod, 'za_malo_danych');
});
