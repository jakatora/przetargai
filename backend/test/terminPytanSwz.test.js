import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Kalkulator TERMINU PYTAŃ do SWZ `terminPytanSwz` (przepisany 2026-09-25).
 *
 * Wcześniej liczył „połowę terminu składania ofert" — reguła UCHYLONEGO art. 38 Pzp
 * z 2004 r. Obowiązujące przepisy (ustawa Pzp z 2019 r.):
 *  • art. 135 ust. 2 pkt 1 — zamawiający odpowiada najpóźniej na 6 dni przed terminem
 *    składania ofert, jeśli wniosek wpłynął nie później niż na 14 dni przed nim;
 *  • art. 135 ust. 2 pkt 2 — przy skróconym terminie (art. 138 ust. 2 pkt 2): 4 dni / 7 dni;
 *  • art. 284 ust. 2 — tryb podstawowy: 2 dni / 4 dni.
 * Liczenie wstecz wg UZP: oferty 1 lipca => wniosek do 17 czerwca (14 dni wstecz, bez dnia
 * składania ofert, ten sam dzień tygodnia). Dni kalendarzowe w czasie polskim.
 * Tryb nieznany => najwcześniejszy bezpieczny termin (14 dni) + informacja o 4 dniach
 * w trybie podstawowym.
 */

const { terminPytanSwz } = await import('../src/lib/terminPytanSwz.js');

// Oferty 1 lipca 2026, 10:00 czasu polskiego (CEST, UTC+2) — przykład UZP.
const LIPIEC = '2026-07-01T08:00:00.000Z';

const PRZYPADKI = [
  // [opis, tryb, termin składania, oczekiwany terminPytan, oczekiwany terminOdpowiedzi, dni przed]
  ['unijny (art. 135 ust. 2 pkt 1): 14 / 6 dni', 'unijny', LIPIEC, '2026-06-17T21:59:59.999Z', '2026-06-25T21:59:59.999Z', 14],
  ['unijny skrócony (art. 135 ust. 2 pkt 2): 7 / 4 dni', 'unijny_skrocony', LIPIEC, '2026-06-24T21:59:59.999Z', '2026-06-27T21:59:59.999Z', 7],
  ['podstawowy (art. 284 ust. 2): 4 / 2 dni', 'podstawowy', LIPIEC, '2026-06-27T21:59:59.999Z', '2026-06-29T21:59:59.999Z', 4],
  ['tryb nieznany => bezpieczne 14 dni', undefined, LIPIEC, '2026-06-17T21:59:59.999Z', '2026-06-25T21:59:59.999Z', 14],
  ['nieznana wartość trybu => jak nieznany', 'przetarg-xyz', LIPIEC, '2026-06-17T21:59:59.999Z', '2026-06-25T21:59:59.999Z', 14],
  // Zima (CET, UTC+1): koniec dnia polskiego = 22:59:59.999Z.
  ['zima (CET): koniec dnia wg czasu polskiego', 'unijny', '2026-12-15T09:00:00.000Z', '2026-12-01T22:59:59.999Z', '2026-12-09T22:59:59.999Z', 14],
  // Północ polska = 22:00Z poprzedniego dnia UTC — dzień składania to 1 lipca, nie 30 czerwca.
  ['termin o północy czasu polskiego liczony od dnia polskiego', 'unijny', '2026-07-01T00:00:00+02:00', '2026-06-17T21:59:59.999Z', '2026-06-25T21:59:59.999Z', 14],
  // Przejście na czas zimowy (25.10.2026) między wnioskiem a terminem.
  ['zmiana czasu w oknie: dzień wniosku w CEST', 'unijny', '2026-11-05T09:00:00.000Z', '2026-10-22T21:59:59.999Z', '2026-10-30T22:59:59.999Z', 14],
];

for (const [opis, tryb, termin, oczekPytan, oczekOdp, dni] of PRZYPADKI) {
  test(`terminPytanSwz — ${opis}`, () => {
    const r = terminPytanSwz({ terminSkladaniaOfert: termin, tryb, teraz: '2026-01-01T00:00:00.000Z' });
    assert.equal(r.terminPytan, oczekPytan);
    assert.equal(r.terminOdpowiedzi, oczekOdp);
    assert.equal(r.dniPrzedTerminem, dni);
  });
}

test('terminPytanSwz — tryb nieznany: informacja o trybie podstawowym (4 dni), tryb=null', () => {
  const r = terminPytanSwz({ terminSkladaniaOfert: LIPIEC, teraz: '2026-06-01T00:00:00.000Z' });
  assert.equal(r.tryb, null);
  assert.match(r.uwaga, /podstawow/i);
  assert.match(r.uwaga, /4 dni/);
  assert.match(r.podstawaPrawna, /art\. 135 ust\. 2/);
});

test('terminPytanSwz — podstawa prawna per tryb', () => {
  assert.match(terminPytanSwz({ terminSkladaniaOfert: LIPIEC, tryb: 'podstawowy' }).podstawaPrawna, /art\. 284 ust\. 2/);
  assert.match(terminPytanSwz({ terminSkladaniaOfert: LIPIEC, tryb: 'unijny_skrocony' }).podstawaPrawna, /art\. 135 ust\. 2 pkt 2/);
  assert.equal(terminPytanSwz({ terminSkladaniaOfert: LIPIEC, tryb: 'unijny' }).uwaga, null);
});

// ── Odliczanie (dniPozostalo / minelo) — granice w czasie polskim ────────────

const ODLICZANIE = [
  // [teraz, dniPozostalo, minelo]
  ['2026-06-10T10:00:00.000Z', 7, false],
  ['2026-06-17T08:00:00.000Z', 0, false], // dzień graniczny — jeszcze można
  ['2026-06-17T21:59:59.999Z', 0, false], // 23:59:59.999 czasu polskiego — granica inkluzywna
  ['2026-06-17T22:00:00.000Z', -1, true], // 00:00 18 czerwca w Polsce — po terminie
];
for (const [teraz, dni, minelo] of ODLICZANIE) {
  test(`terminPytanSwz — odliczanie: teraz=${teraz} => dni ${dni}, minęło=${minelo}`, () => {
    const r = terminPytanSwz({ terminSkladaniaOfert: LIPIEC, tryb: 'unijny', teraz });
    assert.equal(r.dniPozostalo, dni);
    assert.equal(r.minelo, minelo);
    assert.match(r.powod, minelo ? /minął/ : /złóż do końca dnia 2026-06-17/);
  });
}

test('terminPytanSwz — po terminie: pytanie można zadać, ale bez obowiązku odpowiedzi', () => {
  const r = terminPytanSwz({ terminSkladaniaOfert: LIPIEC, tryb: 'unijny', teraz: '2026-06-20T10:00:00.000Z' });
  assert.equal(r.minelo, true);
  assert.match(r.powod, /bez odpowiedzi|nie musi odpowiadać/i);
});

test('terminPytanSwz — dzień wniosku w weekend: uwaga o najbliższym dniu roboczym (UZP)', () => {
  // Oferty w sobotę 4.07.2026 => 14 dni wstecz = sobota 20.06.2026.
  const r = terminPytanSwz({ terminSkladaniaOfert: '2026-07-04T08:00:00.000Z', tryb: 'unijny', teraz: '2026-06-01T00:00:00.000Z' });
  assert.equal(r.terminPytan, '2026-06-20T21:59:59.999Z', 'podajemy bezpieczną (wcześniejszą) datę');
  assert.match(r.uwaga, /dzień roboczy/i);
});

// ── Braki / śmieci — bez zgadywania daty ─────────────────────────────────────

test('terminPytanSwz — brak / niepoprawny termin składania => terminPytan null z powodem', () => {
  for (const arg of [{}, { terminSkladaniaOfert: null }, { terminSkladaniaOfert: 'nie-data' }]) {
    const r = terminPytanSwz(arg);
    assert.equal(r.terminPytan, null);
    assert.equal(r.terminOdpowiedzi, null);
    assert.equal(r.dniPozostalo, null);
    assert.equal(r.minelo, false);
    assert.ok(r.powod.length > 0);
  }
});

test('terminPytanSwz — termin nie późniejszy niż ogłoszenie => null (błędne dane)', () => {
  const r = terminPytanSwz({ dataOgloszenia: '2026-07-02T00:00:00.000Z', terminSkladaniaOfert: LIPIEC });
  assert.equal(r.terminPytan, null);
});

test('terminPytanSwz — data ogłoszenia NIE jest już potrzebna (reguła liczy wstecz od terminu)', () => {
  const r = terminPytanSwz({ terminSkladaniaOfert: LIPIEC, tryb: 'unijny', teraz: '2026-06-01T00:00:00.000Z' });
  assert.equal(r.terminPytan, '2026-06-17T21:59:59.999Z');
});

test('terminPytanSwz — kształt wyniku zgodny z wołającymi (radarSwz, mobile)', () => {
  const r = terminPytanSwz({ terminSkladaniaOfert: LIPIEC });
  for (const k of ['terminPytan', 'polowaTerminu', 'dniPozostalo', 'minelo', 'powod']) {
    assert.ok(k in r, `brak pola ${k}`);
  }
  assert.equal(r.polowaTerminu, null, 'reguła połowy terminu nie obowiązuje — pole zostaje puste');
});
