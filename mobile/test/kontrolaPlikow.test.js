import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sprawdzWyborPlikow, podsumowanieKontroli, opisPodpisu, MAKS_PLIKOW } from '../src/lib/kontrolaPlikow.js';

const t = (pl) => pl;
const MB = 1024 * 1024;

test('wybór plików: za duży pojedynczy, ponad sumę i ponad liczbę → odrzucone z powodem', () => {
  const { pliki, odrzucone } = sprawdzWyborPlikow([
    { name: 'a.pdf', size: 3 * MB, uri: 'a' },
    { name: 'duzy.pdf', size: 11 * MB, uri: 'b' },
    { name: 'b.pdf', size: 9 * MB, uri: 'c' },
    { name: 'c.pdf', size: 3 * MB, uri: 'd' },
  ]);
  assert.deepEqual(pliki.map((p) => p.name), ['a.pdf', 'b.pdf']);
  assert.deepEqual(odrzucone.map((o) => o.nazwa), ['duzy.pdf', 'c.pdf']);
  const wiele = sprawdzWyborPlikow(Array.from({ length: MAKS_PLIKOW + 2 }, (_, i) => ({ name: `${i}.pdf`, size: 10, uri: `${i}` })));
  assert.equal(wiele.pliki.length, MAKS_PLIKOW);
  assert.equal(wiele.odrzucone.length, 2);
});

test('nagłówek raportu i opis podpisu', () => {
  assert.equal(podsumowanieKontroli({ podsumowanie: { bledy: 2, uwagi: 1 } }).ton, 'blad');
  assert.equal(podsumowanieKontroli({ podsumowanie: { bledy: 0, uwagi: 1 } }).pl, 'Bez błędów, 1 rzecz do sprawdzenia');
  assert.equal(podsumowanieKontroli({ podsumowanie: { bledy: 0, uwagi: 0 } }).ton, 'ok');
  assert.equal(opisPodpisu('brak', t), 'BEZ PODPISU');
  assert.equal(opisPodpisu('wewnetrzny', t), 'podpisany');
  assert.equal(opisPodpisu(null, t), '');
});
