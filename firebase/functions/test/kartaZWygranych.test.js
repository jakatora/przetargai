import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kartaZWygranych } from '../src/lib/kartaZWygranych.js';

/*
 * Karta z wygranych (2026-11-01): po NIP-ie z wygranych przetargów — kody CPV (po jednym na klasę,
 * bez kodu całego działu przy dokładniejszych), regiony z przewagą, tytuły do podpowiedzi słów.
 */
const NIP = '5261040828';
const wynik = (id, { cpv, woj = '12', nip = NIP, tytul = `Przetarg ${id}`, opublikowano = '2026-10-01', czesci = 1, uniewaznione = false } = {}) => ({
  externalId: id, tytul, cpv, wojewodztwo: woj, opublikowano, zamawiajacyNip: `70100000${id.length}`,
  czesci: Array.from({ length: czesci }, (_, i) => ({ numer: i + 1, uniewaznione, zwyciezca: { nazwa: 'Firma', nip } })),
});

test('drogowiec z Małopolski: kody 45 bez „45000000”, jeden kod na klasę, region z przewagą', () => {
  const k = kartaZWygranych([
    wynik('a', { cpv: ['45233120-6', '45000000-7'], czesci: 3, tytul: 'Remont drogi gminnej' }),
    wynik('b', { cpv: ['45233140-2'], tytul: 'Przebudowa drogi powiatowej', opublikowano: '2026-10-20' }),
    wynik('c', { cpv: ['45111200-0'], woj: '18' }),
    wynik('d', { cpv: ['45233120-6'], nip: '7941844550' }), // ktoś inny wygrał
    wynik('e', { cpv: ['90620000-9'], uniewaznione: true }), // unieważnione
  ], NIP);
  assert.deepEqual([k.znaleziono, k.wygrane], [true, 5]);
  assert.deepEqual(k.cpv_codes, ['45233120-6', '45111200-0']);
  assert.deepEqual(k.regiony, ['12', '18'], 'Podkarpackie ma 1 z 5 = 20%');
  assert.equal(k.tytuly[0], 'Przebudowa drogi powiatowej', 'najnowsze pierwsze');
});

test('dostawca w całym kraju: bez ograniczenia regionów; brak wygranych → pusta karta', () => {
  const kraj = kartaZWygranych(['02', '04', '06', '08', '10', '12', '14', '16'].map((woj, i) => wynik(`w${i}`, { cpv: ['33140000-3'], woj })), NIP);
  assert.deepEqual([kraj.regiony, kraj.cpv_codes], [[], ['33140000-3']]);
  assert.deepEqual(kartaZWygranych([], NIP), { znaleziono: false, wygrane: 0, cpv_codes: [], regiony: [], tytuly: [], zamawiajacych: 0 });
  assert.equal(kartaZWygranych([wynik('x', { cpv: ['45000000-7'] })], NIP).cpv_codes[0], '45000000-7', 'sam kod działu zostaje, gdy nie ma dokładniejszych');
});
