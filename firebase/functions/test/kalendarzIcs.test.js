import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zbudujKalendarz, doIcs } from '../src/lib/kalendarzPrzetargu.js';

/*
 * Eksport ICS zgodny z RFC 5545 (P2, 2026-09-25).
 *
 *  • Anulowane postępowanie eksportowało się jak żywe: 3 VEVENT + 3 VALARM, czyli
 *    trzy przypomnienia o terminach, które już nie istnieją. Teraz te same UID-y
 *    z STATUS:CANCELLED i WYŻSZYM SEQUENCE — ponowny import odwołuje wydarzenia
 *    zaimportowane wcześniej, zamiast je dublować albo zostawiać.
 *  • `\r` w tytule nie był escapowany — goły CR łamał linię w pół właściwości.
 *  • Linie dłuższe niż 75 oktetów muszą być zawijane (CRLF + spacja); długie
 *    tytuły przetargów (po polsku, wielobajtowe UTF-8) przekraczały to zawsze.
 */

const TERAZ = '2026-10-01T00:00:00.000Z';
const przetarg = (nadpisz = {}) => ({
  id: 'ics-1', source: 'bzp', title: 'Remont drogi', deadline: '2026-10-30T08:00:00.000Z', ...nadpisz,
});
const ics = (tender) => doIcs([zbudujKalendarz(tender, { teraz: TERAZ })], { teraz: TERAZ });
const zlicz = (tekst, wzor) => (tekst.match(wzor) ?? []).length;
/** Rozwinięcie zawiniętych linii (RFC 5545 §3.1). */
const rozwin = (tekst) => tekst.replace(/\r\n[ \t]/g, '');
const uidy = (tekst) => [...rozwin(tekst).matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim());

test('anulowany: te same UID, STATUS:CANCELLED, wyższy SEQUENCE i ZERO przypomnień', () => {
  const zywy = ics(przetarg());
  const anulowany = ics(przetarg({ anulowany: true }));

  assert.equal(zlicz(anulowany, /BEGIN:VEVENT/g), 3, 'każde wcześniej zaimportowane zdarzenie trzeba odwołać');
  assert.equal(zlicz(anulowany, /STATUS:CANCELLED/g), 3);
  assert.equal(zlicz(anulowany, /BEGIN:VALARM/g), 0, 'przypomnienie o terminie anulowanego przetargu to szum');
  assert.deepEqual(uidy(anulowany), uidy(zywy), 'ten sam UID — inaczej kalendarz doda nowe zdarzenie');

  const sekwencje = (tekst) => [...tekst.matchAll(/^SEQUENCE:(\d+)\r$/gm)].map((m) => Number(m[1]));
  assert.equal(sekwencje(zywy).length, 3);
  assert.ok(Math.min(...sekwencje(anulowany)) > Math.max(...sekwencje(zywy)),
    'SEQUENCE odwołania musi być wyższy, inaczej klient zignoruje zmianę');
});

test('żywy przetarg nie ma STATUS:CANCELLED i zachowuje przypomnienia', () => {
  const tekst = ics(przetarg());
  assert.equal(zlicz(tekst, /STATUS:CANCELLED/g), 0);
  assert.equal(zlicz(tekst, /BEGIN:VALARM/g), 3);
});

test('\\r w tytule jest escapowany — żadnego gołego CR poza końcami linii', () => {
  const tekst = ics(przetarg({ title: 'Linia1\rLinia2\r\nLinia3' }));
  assert.equal(zlicz(tekst, /\r(?!\n)/g), 0, 'goły CR łamie właściwość w pół');
  assert.match(rozwin(tekst), /Linia1\\nLinia2\\nLinia3/);
});

test('linie są zawijane do 75 oktetów bez rozcinania znaków UTF-8', () => {
  const tytul = 'Przebudowa drogi gminnej w miejscowości Żółkiewka wraz z budową chodnika, '
    + 'oświetlenia i kanalizacji deszczowej — etap II; zadanie częściowe nr 3 (ąęśćżźńół) '.repeat(3);
  const tekst = ics(przetarg({ title: tytul }));

  for (const linia of tekst.split('\r\n')) {
    assert.ok(Buffer.byteLength(linia, 'utf8') <= 75, `linia ma ${Buffer.byteLength(linia, 'utf8')} oktetów: ${linia}`);
    assert.ok(!linia.includes('�'), 'rozcięty znak wielobajtowy');
  }
  // Po rozwinięciu treść jest nienaruszona (escape przecinków i średników RFC).
  const oczekiwany = `SUMMARY:Pytania do SWZ: ${tytul}`.replaceAll(',', '\\,').replaceAll(';', '\\;');
  assert.ok(rozwin(tekst).split('\r\n').includes(oczekiwany), 'zawinięcie nie może zmienić treści');
});
