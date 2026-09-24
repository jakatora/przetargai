import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { normalizeNotice } = await import('../src/services/bzp.js');
const { mapujOgloszenieTed } = await import('../src/services/ted.js');
const { tenders } = await import('../src/db/repos.js');

const KATALOG = dirname(fileURLToPath(import.meta.url));
const fixture = (nazwa) =>
  JSON.parse(readFileSync(join(KATALOG, 'fixtures', `${nazwa}.json`), 'utf8'));

/*
 * Etap 6: bez identyfikatora POSTĘPOWANIA rozstrzygnięcie nie ma po czym trafić
 * do przetargu — ogłoszenie o wyniku ma INNY numer publikacji niż ogłoszenie
 * o zamówieniu (BZP: 2026/BZP 00448878 vs numer pierwotny; TED: 657221-2026 vs
 * 331270-2026). Zmierzone pokrycie klucza: BZP 3974/3974 ogłoszeń o zamówieniu
 * i 200/200 wyników; TED 250/250 i 100/100.
 */
describe('identyfikator postępowania jako klucz złączenia wynik → przetarg', () => {
  test('BZP: normalizacja niesie postepowanie_id z pola tenderId', () => {
    const znormalizowany = normalizeNotice(fixture('wynik-bez-groszy'));
    assert.match(znormalizowany.postepowanie_id, /^ocds-/);
  });

  test('BZP: ogłoszenie bez tenderId nie wymyśla identyfikatora', () => {
    const znormalizowany = normalizeNotice({ bzpNumber: '2026/BZP 001', orderObject: 'X' });
    assert.equal(znormalizowany.postepowanie_id, null);
  });

  test('TED: mapowanie niesie postepowanie_id z procedure-identifier', () => {
    const znormalizowany = mapujOgloszenieTed({
      'publication-number': '331270-2026',
      'title-proc': { pol: 'Budowa drogi' },
      'procedure-identifier': ['0263930a-8093-4e70-a59a-ecc4edbfe757'],
    });
    assert.equal(znormalizowany.postepowanie_id, '0263930a-8093-4e70-a59a-ecc4edbfe757');
  });

  test('TED: brak pola daje null, a nie „undefined" w bazie', () => {
    const znormalizowany = mapujOgloszenieTed({
      'publication-number': '331270-2026',
      'title-proc': { pol: 'Budowa drogi' },
    });
    assert.equal(znormalizowany.postepowanie_id, null);
  });

  test('zapis przetargu utrwala identyfikator postępowania', async () => {
    const { tender } = await tenders.upsert({
      externalId: 'bzp:etap6-nowy',
      title: 'Przetarg z identyfikatorem postępowania',
      postepowanie_id: 'ocds-148610-aaaa',
    });
    assert.equal(tender.postepowanie_id, 'ocds-148610-aaaa');
  });

  test('przetarg zapisany PRZED etapem 6 dostaje identyfikator przy ponownym pobraniu', async () => {
    await tenders.upsert({ externalId: 'bzp:etap6-stary', title: 'Stary przetarg bez klucza' });
    const ponownie = await tenders.upsert({
      externalId: 'bzp:etap6-stary',
      title: 'Stary przetarg bez klucza',
      postepowanie_id: 'ocds-148610-bbbb',
    });
    assert.equal(ponownie.created, false, 'to ma być ten sam dokument, nie nowy');
    assert.equal(ponownie.tender.postepowanie_id, 'ocds-148610-bbbb');
  });

  test('backfill nie nadpisuje identyfikatora, który już jest', async () => {
    await tenders.upsert({
      externalId: 'bzp:etap6-zajety', title: 'X', postepowanie_id: 'ocds-pierwszy',
    });
    const ponownie = await tenders.upsert({
      externalId: 'bzp:etap6-zajety', title: 'X', postepowanie_id: 'ocds-drugi',
    });
    assert.equal(ponownie.tender.postepowanie_id, 'ocds-pierwszy');
  });
});
