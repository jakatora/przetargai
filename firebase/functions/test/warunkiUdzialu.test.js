import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { warunkiZBk, warunkiZTed, warunkiZBzp, MAKS_ZNAKOW_WARUNKOW } from '../src/lib/warunkiUdzialu.js';

const bk = JSON.parse(fs.readFileSync(new URL('./fixtures/bk-szczegol-292028.json', import.meta.url), 'utf8'));
// Koperta szczegółu BK: `data.advertisement` niesie wersję ogłoszenia z `orders` (zmierzone na fixture).
const koperta = bk.data?.advertisement ?? bk.advertisement ?? bk;
const wersja = koperta.orders ? koperta : (koperta.advertisement ?? koperta);

test('BK: warunki z participation_conditions (fixture 292028 ma 2 warunki)', () => {
  const w = warunkiZBk(wersja.orders);
  assert.equal(w.zrodlo, 'ogloszenie');
  assert.match(w.tekst, /infrastrukturą/);
  assert.match(w.tekst, /koordynatora/);
});

test('BK: brak warunków → null; śmieci → null', () => {
  assert.equal(warunkiZBk([{ order_items: [{ participation_conditions: [] }] }]), null);
  assert.equal(warunkiZBk(undefined), null);
});

test('BK: powtórzony warunek w kilku częściach liczy się raz; tekst przycięty do limitu', () => {
  const dlugi = 'W'.repeat(5000);
  const w = warunkiZBk([{ order_items: [{ participation_conditions: [{ description: dlugi }] }, { participation_conditions: [{ description: dlugi }] }] }]);
  assert.equal(w.tekst.length, MAKS_ZNAKOW_WARUNKOW);
});

test('TED: opis kryteriów kwalifikacji po polsku', () => {
  const w = warunkiZTed({ 'selection-criterion-description-lot': { pol: ['Obrót min. 2 mln zł', 'Obrót min. 2 mln zł', 'Dwie roboty dachowe'] } });
  assert.deepEqual(w, { tekst: 'Obrót min. 2 mln zł\n\nDwie roboty dachowe', zrodlo: 'ogloszenie' });
});

test('TED: warunki w dokumentach zamówienia → zrodlo swz; brak informacji → null', () => {
  assert.deepEqual(warunkiZTed({ 'selection-criteria-source': ['epo-procurement-document'] }), { tekst: null, zrodlo: 'swz' });
  assert.equal(warunkiZTed({}), null);
});

test('BZP: z fixture zmierzonego na żywo (albo null, gdy format niezmierzony)', () => {
  const sciezka = new URL('./fixtures/bzp-warunki.html', import.meta.url);
  if (!fs.existsSync(sciezka)) {
    assert.equal(warunkiZBzp('<p>Warunki udziału w postępowaniu: obrót 1 mln</p>'), null);
    return;
  }
  const w = warunkiZBzp(fs.readFileSync(sciezka, 'utf8'));
  assert.equal(w.zrodlo, 'ogloszenie');
  assert.ok(w.tekst.length > 20);
  assert.ok(!/<[a-z]/i.test(w.tekst), 'bez znaczników HTML');
});
