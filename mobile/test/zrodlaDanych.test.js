import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Źródło pierwotne i świeżość danych na karcie (P1-3) + ekran „Zakres danych".
 *
 * Bez czasu ostatniej synchronizacji „brak nowych przetargów" jest nieodróżnialne
 * od „pobieranie padło trzy dni temu" — a to są przeciwne decyzje: w pierwszym
 * przypadku czekasz, w drugim szukasz gdzie indziej. Ta logika zamienia znacznik
 * ISO w zdanie i w TON, którym ekran go pokoloruje.
 */

const Z = await import('../src/lib/zrodlaDanych.js');

const TERAZ = Date.parse('2026-09-24T12:00:00.000Z');
const temu = (ms) => new Date(TERAZ - ms).toISOString();
const MIN = 60_000;
const H = 3_600_000;
const D = 24 * H;

test('etykieta źródła jest znana dla wszystkich trzech rejestrów', () => {
  assert.equal(Z.etykietaZrodla('bzp').pl, 'BZP');
  assert.equal(Z.etykietaZrodla('ted').pl, 'TED');
  assert.match(Z.etykietaZrodla('baza_konkurencyjnosci').pl, /Konkurencyjn/);
});

test('KRYTYCZNE: nieznane źródło nie udaje BZP — pokazujemy jego własny kod', () => {
  assert.equal(Z.etykietaZrodla('nowy_rejestr').pl, 'nowy_rejestr');
  assert.equal(Z.etykietaZrodla(null).pl, 'BZP', 'brak pola = dane sprzed wprowadzenia źródeł');
});

test('wiek synchronizacji po polsku odmienia się jak człowiek', () => {
  assert.match(Z.opisSynchronizacji(temu(30 * 1000), TERAZ).tekst.pl, /przed chwilą/i);
  assert.match(Z.opisSynchronizacji(temu(5 * MIN), TERAZ).tekst.pl, /5 minut/);
  assert.match(Z.opisSynchronizacji(temu(1 * H), TERAZ).tekst.pl, /godzinę/);
  assert.match(Z.opisSynchronizacji(temu(3 * H), TERAZ).tekst.pl, /3 godziny/);
  assert.match(Z.opisSynchronizacji(temu(8 * H), TERAZ).tekst.pl, /8 godzin/);
  assert.match(Z.opisSynchronizacji(temu(1 * D), TERAZ).tekst.pl, /wczoraj|1 dzień/i);
  assert.match(Z.opisSynchronizacji(temu(4 * D), TERAZ).tekst.pl, /4 dni/);
});

test('wersja angielska istnieje dla każdego przedziału', () => {
  for (const wiek of [30 * 1000, 5 * MIN, 1 * H, 3 * H, 1 * D, 4 * D]) {
    assert.ok(Z.opisSynchronizacji(temu(wiek), TERAZ).tekst.en, `brak EN dla ${wiek} ms`);
  }
});

test('KRYTYCZNE: brak znacznika mówi „nie wiadomo", a nie „przed chwilą"', () => {
  const brak = Z.opisSynchronizacji(null, TERAZ);
  assert.equal(brak.ton, 'neutralny');
  assert.match(brak.tekst.pl, /nie wiadomo|brak/i);
});

test('świeże dane są spokojne, stare ostrzegają, bardzo stare alarmują', () => {
  assert.equal(Z.opisSynchronizacji(temu(2 * H), TERAZ).ton, 'ok');
  assert.equal(Z.opisSynchronizacji(temu(2 * D), TERAZ).ton, 'uwaga');
  assert.equal(Z.opisSynchronizacji(temu(10 * D), TERAZ).ton, 'blad');
});

test('ton stanu źródła odwzorowuje stan z backendu', () => {
  assert.equal(Z.tonStanu('ok'), 'ok');
  assert.equal(Z.tonStanu('opoznione'), 'uwaga');
  assert.equal(Z.tonStanu('awaria'), 'blad');
  assert.equal(Z.tonStanu('wylaczone'), 'neutralny');
  assert.equal(Z.tonStanu('brak_danych'), 'neutralny');
  assert.equal(Z.tonStanu(undefined), 'neutralny');
});

test('podpis na karcie łączy źródło i świeżość w jedną linijkę', () => {
  const podpis = Z.podpisZrodla({ kod: 'bzp', zsynchronizowano_o: temu(2 * H) }, TERAZ);
  assert.match(podpis.tekst.pl, /^BZP/);
  assert.match(podpis.tekst.pl, /2 godziny/);
  assert.equal(podpis.ton, 'ok');
});

test('podpis działa, gdy backend nie oddał metryczki źródła', () => {
  const podpis = Z.podpisZrodla(null, TERAZ);
  assert.ok(podpis.tekst.pl.length > 0);
  assert.equal(podpis.ton, 'neutralny');
});

test('link do oryginału wskazuje ogłoszenie, a rejestr jest wyjściem awaryjnym', () => {
  assert.equal(Z.linkDoOryginalu({ url: 'https://x/ogl/1', zrodlo: { rejestr: 'https://x' } }), 'https://x/ogl/1');
  assert.equal(Z.linkDoOryginalu({ url: null, zrodlo: { rejestr: 'https://x' } }), 'https://x');
  assert.equal(Z.linkDoOryginalu({ url: null, zrodlo: {} }), null);
  assert.equal(Z.linkDoOryginalu(null), null);
});

test('etykieta przycisku otwarcia nazywa REJESTR, nie „stronę"', () => {
  assert.match(Z.etykietaOtwarcia({ kod: 'ted' }).pl, /TED/);
  assert.match(Z.etykietaOtwarcia({ kod: 'ted' }).en, /TED/);
});

test('ostrzeżenie o stanie źródła pojawia się TYLKO gdy jest o czym mówić', () => {
  assert.equal(Z.ostrzezenieZrodla({ stan: 'ok' }), null);
  assert.equal(Z.ostrzezenieZrodla({ stan: 'brak_danych' }), null);
  const awaria = Z.ostrzezenieZrodla({ stan: 'awaria', etykieta: { pl: 'TED', en: 'TED' } });
  assert.match(awaria.tekst.pl, /TED/);
  assert.equal(awaria.ton, 'blad');
});
