import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kluczKlienta } from '../src/lib/clientKey.js';

/*
 * Audyt 2026-07-09/10 (HIGH, dwie iteracje):
 *  1. Klucz brał PIERWSZY wpis X-Forwarded-For — czyli wartość podaną przez klienta.
 *     Losowanie nagłówka przy każdym żądaniu omijało limiter zupełnie.
 *  2. Poprawka na „przedostatni wpis" zakładała konkretną topologię (GFE + LB).
 *     Przy innej liczbie warstw pośrednich przedostatni wpis znów pochodzi od klienta.
 *
 * Rozwiązanie niezależne od topologii: odetnij z końca adresy infrastruktury
 * (zakresy Google 130.211.0.0/22 i 35.191.0.0/16, sieci prywatne, localhost)
 * i weź ostatni adres, który został.
 */

const req = (naglowek, reszta = {}) => ({ headers: naglowek ? { 'x-forwarded-for': naglowek } : {}, ...reszta });
const KLIENT = '203.0.113.7';
const GFE = '130.211.0.1';
const LB = '35.191.5.9';

test('KRYTYCZNE: wstrzyknięty prefiks nie zmienia klucza (topologia z jednym proxy)', () => {
  const uczciwy = kluczKlienta(req(`${KLIENT}, ${GFE}`));
  assert.equal(kluczKlienta(req(`9.9.9.9, ${KLIENT}, ${GFE}`)), uczciwy);
  assert.equal(kluczKlienta(req(`1.2.3.4, 5.6.7.8, ${KLIENT}, ${GFE}`)), uczciwy);
});

test('KRYTYCZNE: wstrzyknięty prefiks nie zmienia klucza (topologia z dwoma proxy)', () => {
  // Ta topologia obalała poprzednią poprawkę „bierz przedostatni".
  const uczciwy = kluczKlienta(req(`${KLIENT}, ${LB}, ${GFE}`));
  assert.equal(kluczKlienta(req(`9.9.9.9, ${KLIENT}, ${LB}, ${GFE}`)), uczciwy);
});

test('KRYTYCZNE: podszywanie się pod adres Google nie pomaga', () => {
  // Klient dokleja adres z zakresu Google, licząc na przesunięcie odczytu.
  const uczciwy = kluczKlienta(req(`${KLIENT}, ${GFE}`));
  assert.equal(kluczKlienta(req(`130.211.0.99, ${KLIENT}, ${GFE}`)), uczciwy,
    'adres Google WSTRZYKNIĘTY na początku nie może zmienić kubełka');
});

test('dwóch realnych klientów trafia do RÓŻNYCH kubełków', () => {
  const a = kluczKlienta(req(`203.0.113.7, ${GFE}`));
  const b = kluczKlienta(req(`198.51.100.9, ${GFE}`));
  assert.notEqual(a, b, 'limiter musi rozróżniać realnych klientów');
});

test('pojedynczy wpis bez proxy (emulator, testy) działa jako adres bezpośredni', () => {
  assert.notEqual(kluczKlienta(req('198.51.100.20')), 'nieznany-klient');
  assert.notEqual(kluczKlienta(req('198.51.100.20')), kluczKlienta(req('198.51.100.21')));
});

test('sam adres infrastruktury: sięgamy po req.ip, potem po gniazdo', () => {
  const zIp = kluczKlienta(req(`${GFE}`, { ip: '203.0.113.55' }));
  assert.notEqual(zIp, 'nieznany-klient');
  const zGniazda = kluczKlienta(req(null, { socket: { remoteAddress: '203.0.113.56' } }));
  assert.notEqual(zGniazda, 'nieznany-klient');
});

test('całkowity brak informacji o adresie nie wywraca limitera', () => {
  // Dawniej `req.ip === undefined` powodowało ERR_ERL_UNDEFINED_IP_ADDRESS.
  assert.equal(kluczKlienta({ headers: {} }), 'nieznany-klient');
  assert.equal(kluczKlienta({}), 'nieznany-klient');
});

test('śmieciowa wartość nagłówka nie rzuca wyjątkiem', () => {
  const klucz = kluczKlienta(req('nie-jest-adresem, ${GFE}'));
  assert.equal(typeof klucz, 'string');
  assert.ok(klucz.length > 0);
});

test('IPv6 z tej samej podsieci /56 dzieli kubełek (nie da się rotować adresami)', () => {
  const a = kluczKlienta(req(`2001:db8:1234:5600::1, ${GFE}`));
  const b = kluczKlienta(req(`2001:db8:1234:5600::abcd, ${GFE}`));
  assert.equal(a, b, 'pula IPv6 jednego klienta to jeden kubełek');
});

test('adresy prywatne i localhost są traktowane jak infrastruktura', () => {
  const uczciwy = kluczKlienta(req(`${KLIENT}, ${GFE}`));
  assert.equal(kluczKlienta(req(`${KLIENT}, 10.0.0.1, 192.168.1.1, ${GFE}`)), uczciwy);
  assert.equal(kluczKlienta(req(`${KLIENT}, 172.16.0.5, 127.0.0.1`)), uczciwy);
});
