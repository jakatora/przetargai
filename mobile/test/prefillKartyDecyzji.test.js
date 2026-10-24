import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefillKartyDecyzji, ocenStart } from '../src/lib/kartaDecyzji.js';

/*
 * Auto-prefill karty decyzji z ogłoszenia i profilu — leniwy użytkownik dostaje większość
 * sygnałów ustawionych. Nigdy nie ustawiamy odpowiedzi blokującej.
 */
const TERAZ = Date.parse('2026-10-24T10:00:00Z');

test('pełne dane: dopasowanie, termin „tak", brak wadium, płynność w limicie — z uzasadnieniami', () => {
  const p = prefillKartyDecyzji({ match: { confidence_score: 82, tender: { deadline: '2026-11-10T10:00:00Z', wadium_wymagane: false, budget: 300000 } }, user: { wartosc_max: 500000 }, teraz: TERAZ });
  assert.deepEqual(p.odpowiedzi, { dopasowanie: 'wysokie', termin: 'tak', wadium: 'tak', plynnosc: 'tak' });
  assert.deepEqual(p.zrodla.map((z) => z.klucz), ['dopasowanie', 'termin', 'wadium', 'plynnosc']);
  assert.match(p.zrodla[1].opis, /17 dni/);
});

test('krótki termin i wartość ponad limit → ostrzeżenia („ryzyko", „napięte"), nigdy blokady; wadium wymagane → nie ustawiamy', () => {
  const p = prefillKartyDecyzji({ match: { confidence_score: 50, tender: { deadline: '2026-10-27T10:00:00Z', wadium_wymagane: true, wadium_kwota: 10000, budget: 900000 } }, user: { wartosc_max: 500000 }, teraz: TERAZ });
  assert.equal(p.odpowiedzi.dopasowanie, 'srednie');
  assert.equal(p.odpowiedzi.termin, 'ryzyko');
  assert.equal(p.odpowiedzi.plynnosc, 'napiete');
  assert.equal(p.odpowiedzi.wadium, undefined);
  assert.equal(ocenStart(p.odpowiedzi).zBlokada, false, 'automat nie generuje czerwonych flag');
});

test('konkurencyjność ze statystyk wyników: mediana ≤ 3 ofert → tak, więcej → średnio; brak statystyk → nic', () => {
  assert.equal(prefillKartyDecyzji({ match: {}, wyniki: { oferty: { mediana: 2 } }, teraz: TERAZ }).odpowiedzi.konkurencyjnosc, 'tak');
  const duzo = prefillKartyDecyzji({ match: {}, wyniki: { oferty: { mediana: 7 } }, teraz: TERAZ });
  assert.equal(duzo.odpowiedzi.konkurencyjnosc, 'srednio');
  assert.match(duzo.zrodla[0].opis, /7 ofert/);
  assert.equal(prefillKartyDecyzji({ match: {}, wyniki: null, teraz: TERAZ }).odpowiedzi.konkurencyjnosc, undefined);
});

test('termin miniony, brak score, brak budżetu lub limitu → nic nie ustawiamy; null nie rzuca', () => {
  const p = prefillKartyDecyzji({ match: { tender: { deadline: '2026-10-01', budget: 100 } }, user: {}, teraz: TERAZ });
  assert.deepEqual(p.odpowiedzi, {});
  assert.deepEqual(prefillKartyDecyzji(null).odpowiedzi, {});
});
