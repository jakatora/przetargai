import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Rejestr adapterów podprogowych — podzadanie 4/7 ulepszenia „Radar zamówień
 * podprogowych". Sprawdza, że wszystkie źródła są wpięte w tę samą listę, po której
 * monitor (6/7) przeleci jednakową ścieżką scalania (adapter → normalizacja → upsert).
 */

const { WSZYSTKIE_ADAPTERY, adapterPoZrodle } = await import('../src/services/adaptery/index.js');
const { ZRODLA } = await import('../src/services/adaptery/kontrakt.js');

test('rejestr: zawiera cztery adaptery o poprawnym kontrakcie', () => {
  assert.equal(WSZYSTKIE_ADAPTERY.length, 4);
  for (const a of WSZYSTKIE_ADAPTERY) {
    assert.equal(typeof a.zrodlo, 'string');
    assert.equal(typeof a.pobierz, 'function');
    assert.ok(ZRODLA.includes(a.zrodlo), `źródło „${a.zrodlo}" musi być dozwolone przez kontrakt/migrację 009`);
  }
});

test('rejestr: obejmuje BK, platformazakupowa, eZamawiający i e-ProPublico', () => {
  const zrodla = WSZYSTKIE_ADAPTERY.map((a) => a.zrodlo);
  assert.deepEqual(
    [...zrodla].sort(),
    ['baza_konkurencyjnosci', 'epropublico', 'ezamawiajacy', 'platformazakupowa'].sort(),
  );
});

test('adapterPoZrodle: znajduje adapter po identyfikatorze źródła', () => {
  assert.equal(adapterPoZrodle('platformazakupowa').zrodlo, 'platformazakupowa');
  assert.equal(adapterPoZrodle('epropublico').zrodlo, 'epropublico');
  assert.equal(adapterPoZrodle('nie-ma-takiego'), undefined);
});
