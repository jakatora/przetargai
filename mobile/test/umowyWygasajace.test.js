import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonTerminu, opisTerminu, opisUmowy, dataKonca } from '../src/lib/umowyWygasajace.js';
import { kwotaKrotko } from '../src/lib/ktoWygrywa.js';

const t = (pl) => pl;

test('pilność i opis terminu końca umowy', () => {
  assert.deepEqual([20, 45, 46, 120, 121, null].map(tonTerminu), ['pilne', 'pilne', 'wkrotce', 'wkrotce', 'neutralne', 'neutralne']);
  assert.deepEqual([0, 1, 20, 60, 61, 150, -1].map((d) => opisTerminu(d, t)), ['kończy się dziś', 'za 1 dzień', 'za 20 dni', 'za 60 dni', 'za ok. 2 mies.', 'za ok. 5 mies.', 'termin nieznany']);
});

test('druga linia karty i data końca po polsku', () => {
  const u = { region_nazwa: 'Wielkopolskie', wartosc: 480000, okres: '12 miesięcy', data_umowy: '2025-12-01', koniec: '2026-11-20' };
  assert.equal(opisUmowy(u, t, kwotaKrotko), `Wielkopolskie · ${kwotaKrotko(480000, t)} · okres: 12 miesięcy · umowa z 01.12.2025`);
  assert.equal(opisUmowy({}, t, kwotaKrotko), '');
  assert.equal(dataKonca(u), '20.11.2026');
  assert.equal(dataKonca({}), null);
});
