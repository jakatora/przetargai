import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.ANTHROPIC_API_KEY = '';
const { normalizujOgloszenieBk } = await import('../src/services/bazaKonkurencyjnosci.js');
const { mapujOgloszenieTed } = await import('../src/services/ted.js');
const { normalizeNotice } = await import('../src/services/bzp.js');

const bk = JSON.parse(fs.readFileSync(new URL('./fixtures/bk-szczegol-292028.json', import.meta.url), 'utf8'));

test('BK: warunki udziału trafiają do przetargu', () => {
  const t = normalizujOgloszenieBk(bk);
  assert.equal(t.warunki_udzialu.zrodlo, 'ogloszenie');
  assert.match(t.warunki_udzialu.tekst, /infrastrukturą/);
});

test('TED: warunki + województwo z NUTS', () => {
  const t = mapujOgloszenieTed({
    'publication-number': '711287-2026', 'title-proc': { pol: ['Serwis klimatyzacji'] },
    'buyer-country-sub': ['PL213'], 'selection-criterion-description-lot': { pol: ['Certyfikat F-gazowy'] },
  });
  assert.equal(t.wojewodztwo, '12');
  assert.deepEqual(t.warunki_udzialu, { tekst: 'Certyfikat F-gazowy', zrodlo: 'ogloszenie' });
});

test('TED bez danych: warunki null, województwo null (nie zgadujemy)', () => {
  const t = mapujOgloszenieTed({ 'publication-number': '1-2026', 'title-proc': { pol: ['X'] } });
  assert.equal(t.warunki_udzialu, null);
  assert.equal(t.wojewodztwo, null);
});

test('BZP: pole warunki_udzialu jest zawsze obecne (null bez sekcji)', () => {
  const t = normalizeNotice({ bzpNumber: '2026/BZP 1/01', orderObject: 'X', htmlBody: '<p>bez sekcji</p>' });
  assert.ok('warunki_udzialu' in t);
  assert.equal(t.warunki_udzialu, null);
});

test('upsert zapisuje warunki i uzupełnia je raz na starym dokumencie', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { polaczZEmulatorem } = await import('./emulator.js');
  await polaczZEmulatorem();
  const { tenders, tenderDocId } = await import('../src/db/repos.js');
  const id = `wi-${process.pid}`;
  await tenders.upsert({ externalId: id, title: 'Stary', deadline: '2099-01-01T00:00:00.000Z' });
  const { tender } = await tenders.upsert({ externalId: id, title: 'Stary', deadline: '2099-01-01T00:00:00.000Z',
    warunki_udzialu: { tekst: 'Obrót 1 mln', zrodlo: 'ogloszenie' }, wojewodztwo: '12' });
  assert.equal(tender.warunki_udzialu.tekst, 'Obrót 1 mln', 'zwrócony dokument ma uzupełnienie');
  const t = await tenders.findById(tenderDocId(id));
  assert.equal(t.warunki_udzialu.tekst, 'Obrót 1 mln');
  assert.equal(t.wojewodztwo, '12');
});
