import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  odliczaniePytan,
  statusPytaniaEtykieta,
  parsujDiff,
  etykietaSekcji,
  etykietaPoziomuBramki,
} from '../src/lib/radarSwz.js';

/*
 * Prezentacja panelu „Radar SWZ" (podzadanie 7/7). Ekran renderuje dane backendu;
 * tu pilnujemy tylko reguł „liczba → słowo": odliczanie do terminu pytań, kolor
 * linii diffu, etykiety statusów/sekcji/bramki.
 */

// ── odliczaniePytan ──────────────────────────────────────────────────────────

test('odliczaniePytan — brak terminu (nieznane daty) => stan „brak", nie pilny', () => {
  assert.equal(odliczaniePytan(null).stan, 'brak');
  assert.equal(odliczaniePytan({ terminPytan: null, dniPozostalo: null, minelo: false }).stan, 'brak');
  assert.equal(odliczaniePytan(undefined).pilny, false);
});

test('odliczaniePytan — termin minął jest jawnie oznaczony i nie jest pilny', () => {
  const o = odliczaniePytan({ terminPytan: '2026-01-06T23:59:59.999Z', dniPozostalo: -3, minelo: true });
  assert.equal(o.stan, 'minelo');
  assert.match(o.etykieta, /minął/i);
  assert.equal(o.pilny, false, 'miniony termin jest martwy, nie „pilny"');
});

test('odliczaniePytan — dziś (0 dni) to ostatni dzień i jest pilne', () => {
  const o = odliczaniePytan({ terminPytan: '2026-01-06T23:59:59.999Z', dniPozostalo: 0, minelo: false });
  assert.equal(o.stan, 'dzis');
  assert.equal(o.pilny, true);
  assert.match(o.etykieta, /dziś/i);
});

test('odliczaniePytan — 1–3 dni to stan pilny; dalej zwykły', () => {
  assert.equal(odliczaniePytan({ terminPytan: 'x', dniPozostalo: 1, minelo: false }).stan, 'pilne');
  assert.equal(odliczaniePytan({ terminPytan: 'x', dniPozostalo: 3, minelo: false }).pilny, true);
  const spokojny = odliczaniePytan({ terminPytan: 'x', dniPozostalo: 8, minelo: false });
  assert.equal(spokojny.stan, 'ok');
  assert.equal(spokojny.pilny, false);
});

test('odliczaniePytan — polska odmiana „dzień/dni"', () => {
  assert.match(odliczaniePytan({ terminPytan: 'x', dniPozostalo: 1, minelo: false }).etykieta, /1 dzień/);
  assert.match(odliczaniePytan({ terminPytan: 'x', dniPozostalo: 5, minelo: false }).etykieta, /5 dni/);
});

// ── statusPytaniaEtykieta ────────────────────────────────────────────────────

test('statusPytaniaEtykieta — znane statusy i fallback', () => {
  assert.equal(statusPytaniaEtykieta('szkic'), 'Szkic');
  assert.equal(statusPytaniaEtykieta('wyslane'), 'Wysłane');
  assert.equal(statusPytaniaEtykieta('odpowiedziane'), 'Odpowiedziane');
  assert.equal(statusPytaniaEtykieta('dziwny'), 'dziwny');
  assert.equal(statusPytaniaEtykieta(undefined), 'Szkic');
});

// ── parsujDiff ───────────────────────────────────────────────────────────────

test('parsujDiff — pusty/null => pusta lista', () => {
  assert.deepEqual(parsujDiff(''), []);
  assert.deepEqual(parsujDiff(null), []);
  assert.deepEqual(parsujDiff('   '), []);
});

test('parsujDiff — rozpoznaje dodane/usunięte/kontekst/zwinięte i ścina znacznik', () => {
  const linie = parsujDiff('-Termin realizacji: 60 dni\n+Termin realizacji: 45 dni\n Paragraf 1\n…');
  assert.deepEqual(linie, [
    { typ: 'usuniete', tekst: 'Termin realizacji: 60 dni' },
    { typ: 'dodane', tekst: 'Termin realizacji: 45 dni' },
    { typ: 'kontekst', tekst: 'Paragraf 1' },
    { typ: 'zwiniete', tekst: '…' },
  ]);
});

test('parsujDiff — linia bez znacznika traktowana jako kontekst (bez ścinania)', () => {
  assert.deepEqual(parsujDiff('Zwykła linia'), [{ typ: 'kontekst', tekst: 'Zwykła linia' }]);
});

// ── etykiety sekcji i bramki ─────────────────────────────────────────────────

test('etykietaSekcji — kanoniczne nazwy i fallback z wielką literą', () => {
  assert.equal(etykietaSekcji('harmonogram'), 'Harmonogram');
  assert.equal(etykietaSekcji('cena'), 'Cena');
  assert.equal(etykietaSekcji('parametry'), 'Parametry');
  assert.equal(etykietaSekcji('inne'), 'Inne');
});

test('etykietaPoziomuBramki — ok/blokada/ostrzeżenie i fallback', () => {
  assert.match(etykietaPoziomuBramki('ok'), /gotowe/i);
  assert.match(etykietaPoziomuBramki('blokada'), /zablokowana/i);
  assert.match(etykietaPoziomuBramki('ostrzezenie'), /nieuwzględnionych/i);
  assert.equal(etykietaPoziomuBramki('cokolwiek'), 'Stan wysyłki');
});
