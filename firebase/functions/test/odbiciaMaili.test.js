import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Odbite adresy (2026-11-07): lista Resend → adresy do blokady i odsetek odbić z doby (czyste funkcje);
 * blokada w `sendEmail` przez `czyAdresOdbity` z atrapą repozytorium (bez bazy).
 */
const { podsumujMaile, odbiciaZaWysokie, normalizujAdres, idAdresu, czasMaila } = await import('../src/lib/odbiciaMaili.js');
const { czyAdresOdbity } = await import('../src/services/email.js');

const TERAZ = '2026-11-07T14:00:00.000Z';
const mail = (to, last_event, created_at = '2026-11-07 11:04:07.381000+00') => ({ to: [to].flat(), last_event, created_at });

test('czasMaila czyta format Resend; normalizacja i id adresu niezależne od wielkości liter', () => {
  assert.equal(czasMaila({ created_at: '2026-11-07 11:04:07.381000+00' }), Date.parse('2026-11-07T11:04:07.381Z'));
  assert.ok(Number.isNaN(czasMaila({})));
  assert.equal(normalizujAdres('  QA-1@Test.PL '), 'qa-1@test.pl');
  assert.equal(idAdresu('QA-1@test.pl'), idAdresu('qa-1@TEST.pl'));
  assert.match(idAdresu('a@b.pl'), /^[0-9a-f]{64}$/);
});

test('podsumujMaile: odbite i zgłoszone jako spam do blokady, odsetek tylko z ostatniej doby', () => {
  const p = podsumujMaile([
    mail('Klient@Gmail.com', 'delivered'),
    mail('qa@test.pl', 'bounced'),
    mail('qa@test.pl', 'bounced', '2026-11-05 11:00:00.000000+00'),
    mail(['spam@x.pl', 'ok@x.pl'], 'complained'),
    mail('stary@x.pl', 'bounced', '2026-11-01 11:00:00.000000+00'),
    mail('w-drodze@x.pl', 'delivery_delayed'),
  ], { teraz: TERAZ });
  assert.deepEqual([...p.adresy.keys()].sort(), ['ok@x.pl', 'qa@test.pl', 'spam@x.pl', 'stary@x.pl']);
  assert.equal(p.adresy.get('qa@test.pl').o, '2026-11-07T11:04:07.381Z', 'najnowsze odbicie');
  assert.equal(p.adresy.get('spam@x.pl').typ, 'complained');
  assert.deepEqual([p.maili24h, p.odbite24h], [4, 2]);
  assert.equal(p.odsetek, 0.5);
  assert.equal(podsumujMaile([], { teraz: TERAZ }).odsetek, null);
});

test('odbiciaZaWysokie: powyżej 5% przy co najmniej 20 mailach', () => {
  assert.equal(odbiciaZaWysokie({ odsetek: 0.4, maili_24h: 50 }), true);
  assert.equal(odbiciaZaWysokie({ odsetek: 0.05, maili_24h: 50 }), false, 'równo 5% — jeszcze nie');
  assert.equal(odbiciaZaWysokie({ odsetek: 0.5, maili_24h: 10 }), false, 'za mało maili, żeby oceniać');
  assert.equal(odbiciaZaWysokie({ odsetek: null, maili_24h: 0 }), false);
});

test('czyAdresOdbity: blokuje tylko, gdy odbity jest każdy adres; błąd odczytu = wysyłamy', async () => {
  const repo = { czy: async (a) => normalizujAdres(a) === 'qa@test.pl' };
  assert.equal(await czyAdresOdbity('QA@test.pl', { repo }), true);
  assert.equal(await czyAdresOdbity('klient@gmail.com', { repo }), false);
  assert.equal(await czyAdresOdbity(['qa@test.pl', 'klient@gmail.com'], { repo }), false, 'lista z dobrym adresem idzie');
  assert.equal(await czyAdresOdbity(undefined, { repo }), false);
  assert.equal(await czyAdresOdbity('qa@test.pl', { repo: { czy: async () => { throw new Error('baza'); } } }), false);
});
