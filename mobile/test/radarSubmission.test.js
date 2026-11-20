import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/screens/RadarSwzScreen.js', import.meta.url), 'utf8');
// Execute the actual screen callbacks with controlled platform/API boundaries.
const callbacks = source.slice(source.indexOf('  async function udostepnijWniosek'), source.indexOf('  // Wejście z przetargu'));
function setup({ share = async () => ({ anulowano: false }), save = async () => {} } = {}) {
  const calls = [], errors = [];
  let detail = { postepowanie: { id: 'A' }, pytania: [{ id: 1, status: 'szkic' }, { id: 2, status: 'wyslane' }] };
  const context = {
    storage: { getItem: async () => null }, KLUCZ_DANYCH_WYKONAWCY: 'company',
    generujWniosekOWyjasnienie: () => ({ tresc: 'draft', nazwa: 'letter' }),
    udostepnijTekst: share, aktywnePostepowanie: { current: 'A' },
    zapisPytanRef: { current: false }, setZapisPytan() {},
    setBladAkcji: v => errors.push(v), t: pl => pl,
    api: { radarPytaniaStatus: async (...args) => { calls.push(args); return save(...args); } },
    setDetal: fn => { detail = fn(detail); },
  };
  vm.createContext(context);
  vm.runInContext(callbacks, context);
  return { context, calls, errors, detail: () => detail,
    share: () => context.udostepnijWniosek(detail.postepowanie, detail.pytania),
    confirm: () => context.potwierdzZlozenie(detail.postepowanie, detail.pytania) };
}
for (const result of [{ sposob: 'share', anulowano: false }, { sposob: 'schowek', anulowano: false }, { anulowano: true }]) {
  test(`sharing ${JSON.stringify(result)} never marks drafts submitted`, async () => {
    const s = setup({ share: async () => result }); await s.share();
    assert.equal(s.calls.length, 0); assert.equal(s.detail().pytania[0].status, 'szkic');
  });
}
test('explicit confirmation persists only draft IDs then updates confirmed status', async () => {
  const s = setup(); await s.confirm();
  assert.equal(JSON.stringify(s.calls), JSON.stringify([['A', { ids: ['1'], status: 'wyslane' }]]));
  assert.equal(s.detail().pytania[0].status, 'wyslane');
  await s.confirm(); assert.equal(s.calls.length, 1);
});
test('failed save retains draft, reports failure and allows retry', async () => {
  let fail = true; const s = setup({ save: async () => { if (fail) throw Error('offline'); } });
  await s.confirm(); assert.equal(s.detail().pytania[0].status, 'szkic');
  assert.match(s.errors.at(-1), /offline/);
  fail = false; await s.confirm(); assert.equal(s.detail().pytania[0].status, 'wyslane');
});
test('double click sends once; late completion does not change another procedure', async () => {
  let resolve; const s = setup({ save: () => new Promise(r => { resolve = r; }) });
  const first = s.confirm(); await s.confirm(); assert.equal(s.calls.length, 1);
  s.context.aktywnePostepowanie.current = 'B'; resolve(); await first;
  assert.equal(s.detail().pytania[0].status, 'szkic');
});
test('share failure is visible without changing submission status', async () => {
  const s = setup({ share: async () => { throw Error('clipboard denied'); } });
  await s.share(); assert.match(s.errors.at(-1), /clipboard denied/); assert.equal(s.calls.length, 0);
});
