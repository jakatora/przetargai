import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

/*
 * Audyt 2026-07-10 (HIGH): terminy z BZP porównujemy leksykograficznie z `nowIso()`
 * (`deadline > now` w zapytaniu i przy filtrowaniu). To działa TYLKO wtedy, gdy
 * wszystkie znaczniki są w tej samej strefie i formacie. BZP tego nie gwarantuje.
 *
 * Zmierzone kontrprzykłady (teraz = 2026-07-10T12:00:00.000Z):
 *   "2026-07-10T13:30:00+02:00"  → realnie 11:30 UTC, termin MINĄŁ,
 *                                  leksykograficznie wygląda na przyszły;
 *   "2026-07-10T11:00:00-02:00"  → realnie 13:00 UTC, termin OTWARTY,
 *                                  leksykograficznie wygląda na miniony.
 *
 * Skutek: przetargi po terminie zostają w puli i wracają do płatnego AI, a otwarte
 * z ujemnym offsetem wypadają. Normalizujemy WSZYSTKIE daty do UTC przy zapisie.
 */

const { doUtcIso } = await import('../src/lib/daty.js');

test('doUtcIso — dodatni offset przeliczany na UTC (a nie ucinany)', () => {
  assert.equal(doUtcIso('2026-07-10T13:30:00+02:00'), '2026-07-10T11:30:00.000Z');
});

test('doUtcIso — ujemny offset przeliczany na UTC', () => {
  assert.equal(doUtcIso('2026-07-10T11:00:00-02:00'), '2026-07-10T13:00:00.000Z');
});

test('doUtcIso — znacznik już w UTC zostaje bez zmian (poza formatem)', () => {
  assert.equal(doUtcIso('2026-07-20T08:00:00Z'), '2026-07-20T08:00:00.000Z');
  assert.equal(doUtcIso('2026-07-20T08:00:00.000Z'), '2026-07-20T08:00:00.000Z');
});

test('doUtcIso — data bez strefy: traktujemy jako czas POLSKI, nie UTC', () => {
  /*
   * BZP publikuje terminy w czasie polskim. Uznanie ich za UTC przesunęłoby
   * termin o 2 godziny w przyszłość — pokazywalibyśmy przetarg jeszcze przez
   * 2 godziny po faktycznym zamknięciu składania ofert.
   */
  // 10 lipca 2026 to czas letni (UTC+2).
  assert.equal(doUtcIso('2026-07-20T08:00:00'), '2026-07-20T06:00:00.000Z');
  // Styczeń — czas zimowy (UTC+1).
  assert.equal(doUtcIso('2026-01-20T08:00:00'), '2026-01-20T07:00:00.000Z');
});

test('doUtcIso — sama data (bez godziny) to koniec dnia w Polsce', () => {
  // „Termin: 20 lipca" znaczy „do końca 20 lipca", nie „o północy".
  assert.equal(doUtcIso('2026-07-20'), '2026-07-20T21:59:59.999Z'); // 23:59:59.999 CEST
});

test('doUtcIso — brak wartości i śmieci dają null (przetarg bez terminu)', () => {
  assert.equal(doUtcIso(null), null);
  assert.equal(doUtcIso(undefined), null);
  assert.equal(doUtcIso(''), null);
  assert.equal(doUtcIso('nie-jest-data'), null);
});

test('KRYTYCZNE: po normalizacji porównanie leksykograficzne jest ZGODNE z czasem', () => {
  const teraz = '2026-07-10T12:00:00.000Z';
  const przypadki = [
    '2026-07-10T13:30:00+02:00', // minął
    '2026-07-10T11:00:00-02:00', // otwarty
    '2026-07-20T08:00:00Z',      // otwarty
    '2026-07-01T08:00:00',       // minął
  ];

  for (const surowy of przypadki) {
    const znormalizowany = doUtcIso(surowy);
    const leksykograficznie = znormalizowany > teraz;
    const naprawde = new Date(surowy).getTime() > new Date(teraz).getTime();
    assert.equal(leksykograficznie, naprawde,
      `${surowy} → ${znormalizowany}: porównanie tekstowe rozjeżdża się z czasem`);
  }
});
