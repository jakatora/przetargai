import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  terminPytan, wOknie, trescPrzypomnieniaPytan, OKNO_PRZYPOMNIENIA_PYTAN_MS, TYP_PUSH_PYTANIA,
} from '../src/lib/przypomnieniePytan.js';

/*
 * Przypomnienie o terminie pytań do SWZ — czysta logika (funkcja A, 2026-09-29).
 *
 * Termin NIE jest tu liczony od nowa: pochodzi z lib/kalendarzPrzetargu.js (ta sama
 * reguła co w kalendarzu terminów — art. 284 ust. 2 / art. 135 ust. 2 Pzp). Ten plik
 * pilnuje tylko okna wysyłki i treści.
 */

const GODZINA = 3_600_000;
const DZIEN = 24 * GODZINA;

test('BZP: termin pytań = termin składania minus 4 dni (reguła z kalendarza)', () => {
  const poz = terminPytan({ id: 't', source: 'bzp', deadline: '2026-10-09T08:00:00.000Z' }, '2026-10-01T00:00:00.000Z');
  assert.equal(poz.at, '2026-10-05T08:00:00.000Z');
  assert.equal(poz.podstawa.pl, 'art. 284 ust. 2 Pzp');
});

test('TED: termin pytań = termin składania minus 14 dni', () => {
  const poz = terminPytan({ id: 't', source: 'ted', deadline: '2026-10-30T08:00:00.000Z' }, '2026-10-01T00:00:00.000Z');
  assert.equal(poz.at, '2026-10-16T08:00:00.000Z');
});

test('brak terminu, rejestr bez reguły ustawowej (BK) albo anulowany — brak terminu, nic nie zmyślamy', () => {
  const teraz = '2026-10-01T00:00:00.000Z';
  assert.equal(terminPytan({ id: 't', source: 'bzp', deadline: null }, teraz), null);
  assert.equal(terminPytan({ id: 't', source: 'bk', deadline: '2026-10-09T08:00:00.000Z' }, teraz), null);
  assert.equal(terminPytan({ id: 't', source: 'bzp', deadline: '2026-10-09T08:00:00.000Z', anulowany: true }, teraz), null);
});

test('okno: wysyłka tylko w ostatniej dobie przed terminem pytań', () => {
  const tender = { id: 't', source: 'bzp', deadline: '2026-10-09T08:00:00.000Z' }; // pytania 5.10 08:00Z
  const pytania = Date.parse('2026-10-05T08:00:00.000Z');
  const naChwile = (ms) => new Date(pytania - ms).toISOString();
  assert.equal(wOknie(terminPytan(tender, naChwile(25 * GODZINA)), naChwile(25 * GODZINA)), false, 'za wcześnie');
  assert.equal(wOknie(terminPytan(tender, naChwile(23 * GODZINA)), naChwile(23 * GODZINA)), true);
  assert.equal(wOknie(terminPytan(tender, naChwile(OKNO_PRZYPOMNIENIA_PYTAN_MS)), naChwile(OKNO_PRZYPOMNIENIA_PYTAN_MS)), true, 'granica doby');
  assert.equal(wOknie(terminPytan(tender, naChwile(0)), naChwile(0)), false, 'termin właśnie minął');
  assert.equal(wOknie(terminPytan(tender, naChwile(-DZIEN)), naChwile(-DZIEN)), false, 'po terminie');
  assert.equal(wOknie(null, naChwile(GODZINA)), false, 'brak terminu');
});

test('treść PL w czasie warszawskim — lato (CEST, UTC+2)', () => {
  const poz = terminPytan({ id: 't1', source: 'bzp', deadline: '2026-10-09T08:00:00.000Z' }, '2026-10-04T12:00:00.000Z');
  const tresc = trescPrzypomnieniaPytan({ tenderId: 't1', tytul: 'Przebudowa chodnika', pozycja: poz });
  assert.match(tresc.title, /pytania do SWZ/i);
  assert.match(tresc.body, /Przebudowa chodnika/);
  assert.match(tresc.body, /5 października 2026, 10:00/, '08:00 UTC to 10:00 w Warszawie latem');
  assert.match(tresc.body, /art\. 284 ust\. 2 Pzp/);
  assert.deepEqual(tresc.data, { type: TYP_PUSH_PYTANIA, tender_id: 't1', termin: '2026-10-05T08:00:00.000Z' });
});

test('treść PL w czasie warszawskim — zima (CET, UTC+1, po zmianie czasu 25.10)', () => {
  const poz = terminPytan({ id: 't2', source: 'bzp', deadline: '2026-10-31T09:00:00.000Z' }, '2026-10-26T12:00:00.000Z');
  const tresc = trescPrzypomnieniaPytan({ tenderId: 't2', tytul: 'Remont drogi', pozycja: poz });
  assert.match(tresc.body, /27 października 2026, 10:00/, '09:00 UTC to 10:00 w Warszawie zimą');
});
