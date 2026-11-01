import { test } from 'node:test';
import assert from 'node:assert/strict';

import { obserwacjaOtwarcia, zbudujBenchmarkOtwarcia, kluczeOtwarcia, czynnikIleDac, MIN_PROBKA_OTWARCIA } from '../src/lib/benchmarkOtwarcia.js';
import { kartaStartu } from '../src/lib/czyWartoStartowac.js';
import { runBenchmarkOtwarcia } from '../src/jobs/otwarcieRynku.js';

/*
 * „Ile dać” (2026-11-01): najniższa oferta / budżet zamawiającego z informacji z otwarcia ofert (obie brutto),
 * kubełki dział CPV × województwo i dział w kraju, od 8 przetargów.
 */
const przetarg = (stosunek, { cpv = '45233140-2', woj = '18', oferty = 4, czesci = false, kwota = 100_000 } = {}) => ({
  cpv_main: cpv, wojewodztwo: woj, otwarcie_ofert: { kwota, cena_min: kwota * stosunek, cena_max: kwota * 1.3, oferty, czesci },
});

test('obserwacja: bez części, kwota ≥ 1000, iloraz 0,2–2', () => {
  assert.deepEqual(obserwacjaOtwarcia(przetarg(0.85)), { dzial: '45', woj: '18', stosunek: 0.85, oferty: 4 });
  assert.equal(obserwacjaOtwarcia(przetarg(0.85, { czesci: true })), null);
  assert.equal(obserwacjaOtwarcia(przetarg(0.1)), null);
  assert.equal(obserwacjaOtwarcia(przetarg(2.5)), null);
  assert.equal(obserwacjaOtwarcia(przetarg(0.9, { kwota: 500 })), null);
  assert.equal(obserwacjaOtwarcia({ otwarcie_ofert: null }), null);
});

test('kubełki: region i kraj, mediana i kwartyle, próg próbki', () => {
  const lista = [0.7, 0.75, 0.8, 0.82, 0.85, 0.88, 0.9, 0.95].map((s) => przetarg(s));
  const k = zbudujBenchmarkOtwarcia([...lista, przetarg(0.6, { woj: '12' })]);
  assert.equal(MIN_PROBKA_OTWARCIA, 8);
  assert.deepEqual(Object.keys(k).sort(), ['otw:45', 'otw:45|18']);
  assert.equal(k['otw:45|18'].n, 8);
  assert.equal(k['otw:45|18'].stosunek.mediana, 0.835);
  assert.equal(k['otw:45'].n, 9);
  assert.ok(k['otw:45|18'].stosunek.q1 < 0.835 && k['otw:45|18'].stosunek.q3 > 0.835);
  assert.deepEqual(kluczeOtwarcia({ cpv_main: '45233140-2', wojewodztwo: '18' }), { region: 'otw:45|18', kraj: 'otw:45' });
});

test('czynnik: procent poniżej budżetu, widełki, złotówki przy znanym budżecie; bez kubełka null', () => {
  const kubelek = { dzial: '45', woj: '18', n: 12, stosunek: { mediana: 0.86, q1: 0.78, q3: 0.93 }, oferty_mediana: 5 };
  const c = czynnikIleDac(kubelek, { otwarcie_ofert: { kwota: 195_457.23 } });
  assert.equal(c.kod, 'ile_dac');
  assert.equal(c.ton, 'zolty');
  assert.equal(c.naglowek, 'Najniższe oferty schodzą zwykle ok. 14% poniżej budżetu zamawiającego');
  assert.equal(c.szczegol, 'W połowie przetargów w tej branży w Twoim województwie najniższa oferta to 78%–93% budżetu; ofert zwykle 5. Tu zamawiający przeznaczył 195 457 zł — najniższa oferta wyszłaby zwykle ok. 168 093 zł.');
  assert.match(czynnikIleDac({ ...kubelek, woj: null, stosunek: { mediana: 1.05, q1: 0.95, q3: 1.1 } }, {}).naglowek, /ok\. 5% powyżej budżetu/);
  assert.equal(czynnikIleDac(null, {}), null);
  assert.equal(czynnikIleDac({ ...kubelek, n: 3 }, {}), null);
});

test('karta startu: czynnik „ile dać” jest, ale nie zmienia werdyktu', () => {
  const tender = { deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(), cpv_main: '45233140-2', wojewodztwo: '18' };
  const bez = kartaStartu({ tender, benchmarki: {} });
  const z = kartaStartu({ tender, benchmarki: {}, otwarcie: { dzial: '45', woj: '18', n: 12, stosunek: { mediana: 0.86, q1: 0.78, q3: 0.93 }, oferty_mediana: 5 } });
  assert.equal(z.werdykt, bez.werdykt);
  assert.ok(z.czynniki.some((c) => c.kod === 'ile_dac'));
  assert.ok(!bez.czynniki.some((c) => c.kod === 'ile_dac'));
});

test('job przeliczenia: czyta przetargi z otwarciem i zapisuje kubełki', async () => {
  let zapisane = null;
  const w = await runBenchmarkOtwarcia({
    przetargi: { zOtwarciem: async () => [0.7, 0.75, 0.8, 0.82, 0.85, 0.88, 0.9, 0.95].map((s) => przetarg(s)) },
    repo: { zapisz: async (k) => { zapisane = k; return Object.keys(k).length; } },
  });
  assert.deepEqual(w, { ok: true, przetargow: 8, kubelkow: 2 });
  assert.ok(zapisane['otw:45|18']);
});
