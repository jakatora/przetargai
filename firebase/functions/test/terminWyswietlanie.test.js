import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotice } from '../src/services/bzp.js';
import { normalizujOgloszeniePz } from '../src/services/platformaZakupowa.js';
import { mapujOgloszenieTed } from '../src/services/ted.js';
import { normalizujOgloszenieBk } from '../src/services/bazaKonkurencyjnosci.js';
import { publicTender, publicMatch, publicSaved } from '../src/lib/serialize.js';
import { formatDeadline } from '../../../mobile/src/lib/format.js';

// Granica rzeczywistych adapterów źródeł → normalna reprezentacja API → klient.
const wyswietl = (t) => {
  const api = publicTender({ ...t, id: t.externalId });
  return formatDeadline(api.deadline, 'czas polski', api.source);
};

test('BZP: składanie 09:00, a nie otwarcie 09:30; API zachowuje godzinę', () => {
  const t = normalizeNotice({ bzpNumber: '2026/BZP 00552469/01', orderObject: 'Projektory AST',
    submittingOffersDate: '2026-11-30T09:00:00', openingOffersDate: '2026-11-30T09:30:00' });
  assert.equal(t.deadline, '2026-11-30T08:00:00.000Z');
  assert.equal(wyswietl(t), '30 listopada 2026, 09:00 (czas polski)');
});

test('platformazakupowa: MGDK zimą oraz termin letni', () => {
  const t = normalizujOgloszeniePz({ id: '1414057', tytul: 'MGDK.03.2026.BG', termin: '24-11-2026 14:00:00' });
  assert.equal(t.deadline, '2026-11-24T13:00:00.000Z');
  assert.equal(wyswietl(t), '24 listopada 2026, 14:00 (czas polski)');
  assert.equal(wyswietl(normalizujOgloszeniePz({ id: 'test', tytul: 'Lato', termin: '20-07-2026 09:15:00' })), '20 lipca 2026, 09:15 (czas polski)');
});

test('TED sam dzień z offsetem i BK koniec dnia nie stają się znaną godziną', () => {
  const ted = mapujOgloszenieTed({ 'publication-number': 'test', 'title-proc': { pol: ['Test'] }, 'deadline-receipt-tender-date-lot': ['2026-09-08+02:00'] });
  assert.equal(wyswietl(ted), '8 września 2026');
  const bk = normalizujOgloszenieBk({ data: { advertisement: { advertisement: { id: 298767 }, title: 'Warsztaty', submission_deadline: '2026-12-01 23:59:59' } } });
  assert.equal(wyswietl(bk), '1 grudnia 2026');
});

test('dopasowane i zapisane zachowują dokładnie ten sam termin w reprezentacji API', () => {
  const row = { tender_id: 'test', tender_deadline: '2026-11-29T23:00:00.000Z' };
  for (const serialize of [publicMatch, publicSaved]) assert.equal(formatDeadline(serialize(row).tender.deadline), '30 listopada 2026, 00:00 (czas polski)');
  assert.equal(wyswietl(normalizeNotice({ bzpNumber: 'brak', orderObject: 'Bez terminu' })), 'brak danych');
});
