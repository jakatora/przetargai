import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KLUCZE_STANU_EKRANU, wczytajStanEkranu, zapiszStanEkranu } from '../src/lib/stanEkranu.js';
import { PREFIKSY_KONTA, KLUCZ_INDEKSU_KONTA } from '../src/lib/daneLokalne.js';

const magazyn = () => { const m = new Map(); return { m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, deleteItem: async (k) => { m.delete(k); } }; };

test('każdy klucz stanu ekranu ma prefiks sklasyfikowany jako dana konta (kasowana przy wylogowaniu)', () => {
  for (const klucz of Object.values(KLUCZE_STANU_EKRANU)) {
    const przyklad = klucz('x');
    assert.ok(PREFIKSY_KONTA.some((p) => przyklad.startsWith(p)), `${przyklad} bez prefiksu w PREFIKSY_KONTA`);
  }
});

test('zapis/odczyt per przetarg, id oczyszczone do SecureStore, klucz w indeksie konta; śmieci i brak → null', async () => {
  const s = magazyn();
  const k = KLUCZE_STANU_EKRANU.poWygranej;
  assert.equal(await wczytajStanEkranu(s, k, 'bzp:2026-BZP-1'), null);
  await zapiszStanEkranu(s, k, 'bzp:2026-BZP-1', { umowa: { numerUmowy: 'UM/1' }, pismo: 'termin' });
  assert.deepEqual(await wczytajStanEkranu(s, k, 'bzp:2026-BZP-1'), { umowa: { numerUmowy: 'UM/1' }, pismo: 'termin' });
  assert.equal(k('bzp:2026-BZP-1'), 'przetargai.po-wygranej.bzp_2026-BZP-1');
  assert.ok(String(s.m.get(KLUCZ_INDEKSU_KONTA)).includes(k('bzp:2026-BZP-1')));
  s.m.set(k('x'), 'nie-json');
  assert.equal(await wczytajStanEkranu(s, k, 'x'), null);
  await zapiszStanEkranu(s, k, null, { a: 1 });
  assert.equal(await wczytajStanEkranu(s, k, null), null);
});
