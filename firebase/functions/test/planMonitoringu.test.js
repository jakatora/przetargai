import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAKS_DNI_WSTECZ,
  noweTrafienia, zmianyDlaWyszukiwania, zbudujAlertNowych, zbudujAlertZmian,
  trescPush, oknoOdczytuZmian,
} from '../src/lib/planMonitoringu.js';

/*
 * PLAN PRZEBIEGU MONITORINGU (etap 5) — CZYSTA logika.
 *
 * Harmonogram sam w sobie jest banalny: odczytaj, porównaj, wyślij. Cała trudność
 * jest w decyzjach, które łatwo podjąć źle i których skutku nie widać w logach:
 *
 *  • PIERWSZY przebieg nowego wyszukiwania NIE MOŻE powiadamiać. Filtr obejmujący
 *    10 tysięcy otwartych ogłoszeń wysłałby w sekundę powiadomienie „10 000 nowych",
 *    po którym użytkownik wyłącza push dla całej aplikacji — i traci też
 *    przypomnienia o terminach.
 *  • Powiadamiamy o zmianach ISTOTNYCH i tylko takich, które dotyczą ogłoszeń
 *    pasujących do TEGO wyszukiwania.
 *  • Klucz alertu musi być deterministyczny, bo to on — a nie ostrożność joba —
 *    gwarantuje, że ponowiony przebieg nie wyśle tego samego dwa razy.
 */

const WYSZUKIWANIE = {
  id: 'w1', nazwa: 'Drogi w Małopolsce', filtry: { zrodlo: 'bzp', termin: 'aktywne' },
};

const tender = (id, over = {}) => ({
  id,
  title: `Ogłoszenie ${id}`,
  source: 'bzp',
  deadline: '2099-01-01T00:00:00.000Z',
  fetched_at: '2026-09-24T10:00:00.000Z',
  ...over,
});

test('PIERWSZY przebieg nie powiadamia — ustawia tylko punkt odniesienia', () => {
  const wynik = noweTrafienia({
    tenders: [tender('t1'), tender('t2')],
    kursor: null,
    teraz: '2026-09-24T12:00:00.000Z',
  });

  assert.equal(wynik.pierwszyPrzebieg, true);
  assert.deepEqual(wynik.pozycje, [], 'zero powiadomień o zastanym rynku');
  assert.ok(wynik.nowyKursor, 'ale punkt odniesienia MUSI zostać zapisany');
});

test('pierwszy przebieg na PUSTYM wyniku też zapisuje punkt odniesienia', () => {
  const wynik = noweTrafienia({ tenders: [], kursor: null, teraz: '2026-09-24T12:00:00.000Z' });
  assert.equal(wynik.pierwszyPrzebieg, true);
  assert.equal(wynik.nowyKursor.fetched_at, '2026-09-24T12:00:00.000Z',
    'bez trafień punktem odniesienia jest chwila sprawdzenia');
});

test('kolejny przebieg zgłasza WYŁĄCZNIE ogłoszenia nowsze od punktu odniesienia', () => {
  const wynik = noweTrafienia({
    tenders: [
      tender('nowy', { fetched_at: '2026-09-24T11:00:00.000Z' }),
      tender('stary', { fetched_at: '2026-09-24T09:00:00.000Z' }),
    ],
    kursor: { fetched_at: '2026-09-24T10:00:00.000Z' },
    teraz: '2026-09-24T12:00:00.000Z',
  });

  assert.equal(wynik.pierwszyPrzebieg, false);
  assert.deepEqual(wynik.pozycje.map((t) => t.id), ['nowy']);
  assert.equal(wynik.nowyKursor.fetched_at, '2026-09-24T11:00:00.000Z');
});

test('brak nowości nie cofa punktu odniesienia', () => {
  const kursor = { fetched_at: '2026-09-24T10:00:00.000Z' };
  const wynik = noweTrafienia({
    tenders: [tender('stary', { fetched_at: '2026-09-24T09:00:00.000Z' })],
    kursor,
    teraz: '2026-09-24T12:00:00.000Z',
  });
  assert.deepEqual(wynik.pozycje, []);
  assert.equal(wynik.nowyKursor.fetched_at, '2026-09-24T10:00:00.000Z');
});

test('ogłoszenie o dokładnie tym samym znaczniku nie wraca jako nowe', () => {
  const wynik = noweTrafienia({
    tenders: [tender('graniczny', { fetched_at: '2026-09-24T10:00:00.000Z' })],
    kursor: { fetched_at: '2026-09-24T10:00:00.000Z' },
    teraz: '2026-09-24T12:00:00.000Z',
  });
  assert.deepEqual(wynik.pozycje, []);
});

test('zmiany: bierzemy tylko ISTOTNE i tylko z ogłoszeń pasujących do filtrów', () => {
  const tenderyById = new Map([
    ['pasuje', tender('pasuje')],
    ['obce', tender('obce', { source: 'ted' })],
  ]);
  const zmiany = [
    { id: 'z1', tenderId: 'pasuje', typ: 'termin', wykryto_o: '2026-09-24T11:00:00.000Z', opis: { pl: 'x', en: 'x' } },
    { id: 'z2', tenderId: 'pasuje', typ: 'tresc', wykryto_o: '2026-09-24T11:00:00.000Z', opis: { pl: 'y', en: 'y' } },
    { id: 'z3', tenderId: 'obce', typ: 'termin', wykryto_o: '2026-09-24T11:00:00.000Z', opis: { pl: 'z', en: 'z' } },
    { id: 'z4', tenderId: 'nieznane', typ: 'termin', wykryto_o: '2026-09-24T11:00:00.000Z', opis: { pl: 'q', en: 'q' } },
  ];

  const trafienia = zmianyDlaWyszukiwania({
    zmiany, tenderyById, filtry: WYSZUKIWANIE.filtry, teraz: '2026-09-24T12:00:00.000Z', od: '2026-09-24T00:00:00.000Z',
  });

  assert.deepEqual(trafienia.map((t) => t.zmiana.id), ['z1']);
});

test('zmiany sprzed ostatniego sprawdzenia nie wracają po raz drugi', () => {
  const tenderyById = new Map([['t1', tender('t1')]]);
  const zmiany = [
    { id: 'stara', tenderId: 't1', typ: 'termin', wykryto_o: '2026-09-20T11:00:00.000Z', opis: { pl: 'x', en: 'x' } },
    { id: 'nowa', tenderId: 't1', typ: 'termin', wykryto_o: '2026-09-24T11:00:00.000Z', opis: { pl: 'x', en: 'x' } },
  ];

  const trafienia = zmianyDlaWyszukiwania({
    zmiany, tenderyById, filtry: WYSZUKIWANIE.filtry, teraz: '2026-09-24T12:00:00.000Z', od: '2026-09-24T00:00:00.000Z',
  });
  assert.deepEqual(trafienia.map((t) => t.zmiana.id), ['nowa']);
});

test('ANULOWANE ogłoszenie nadal generuje alert, choć wypadło z filtrów', () => {
  /*
   * `pasujeDoFiltrow` odrzuca anulowane — i słusznie, bo katalog nie ma ich pokazywać.
   * Ale alert o anulowaniu to DOKŁADNIE ta informacja, po którą użytkownik przyszedł:
   * bez niej dowie się o unieważnieniu dopiero wtedy, gdy przygotuje ofertę.
   */
  const tenderyById = new Map([['t1', tender('t1', { anulowany: true })]]);
  const zmiany = [
    { id: 'anul', tenderId: 't1', typ: 'anulowanie', wykryto_o: '2026-09-24T11:00:00.000Z', opis: { pl: 'x', en: 'x' } },
  ];

  const trafienia = zmianyDlaWyszukiwania({
    zmiany, tenderyById, filtry: WYSZUKIWANIE.filtry, teraz: '2026-09-24T12:00:00.000Z', od: '2026-09-24T00:00:00.000Z',
  });
  assert.deepEqual(trafienia.map((t) => t.zmiana.id), ['anul']);
});

test('alert o nowych trafieniach ma deterministyczny klucz i wymienia ograniczoną liczbę pozycji', () => {
  const pozycje = Array.from({ length: 12 }, (_, i) => tender(`t${i}`, { fetched_at: `2026-09-24T1${i % 10}:00:00.000Z` }));
  const a = zbudujAlertNowych({ wyszukiwanie: WYSZUKIWANIE, pozycje });
  const b = zbudujAlertNowych({ wyszukiwanie: WYSZUKIWANIE, pozycje });

  assert.equal(a.klucz, b.klucz);
  assert.equal(a.typ, 'nowe_trafienia');
  assert.equal(a.wyszukiwanie_id, 'w1');
  assert.ok(a.pozycje.length <= 5, 'push z dwunastoma tytułami jest nie do przeczytania');
  assert.match(a.tytul.pl, /Drogi w Małopolsce/);
  assert.match(a.tresc.pl, /12/, 'pełna liczba musi zostać podana, choć wymieniamy kilka');
  assert.ok(a.tresc.en.length > 0);
});

test('inny zestaw trafień daje inny klucz — dwa przebiegi z różnym plonem to dwa alerty', () => {
  const a = zbudujAlertNowych({ wyszukiwanie: WYSZUKIWANIE, pozycje: [tender('t1')] });
  const b = zbudujAlertNowych({ wyszukiwanie: WYSZUKIWANIE, pozycje: [tender('t2')] });
  assert.notEqual(a.klucz, b.klucz);
});

test('alert o zmianach niesie ton NAJPOWAŻNIEJSZEJ zmiany w partii', () => {
  const trafienia = [
    { zmiana: { id: 'z1', typ: 'wartosc', ton: 'ostrzezenie', opis: { pl: 'a', en: 'a' } }, tender: tender('t1') },
    { zmiana: { id: 'z2', typ: 'anulowanie', ton: 'danger', opis: { pl: 'b', en: 'b' } }, tender: tender('t2') },
  ];
  const alert = zbudujAlertZmian({ wyszukiwanie: WYSZUKIWANIE, trafienia });

  assert.equal(alert.typ, 'zmiany');
  assert.equal(alert.ton, 'danger');
  assert.ok(alert.klucz.includes('w1'));
});

test('klucz alertu o zmianach nie zależy od KOLEJNOŚCI, w jakiej przyszły', () => {
  const z1 = { zmiana: { id: 'a', typ: 'termin', ton: 'danger', opis: { pl: 'x', en: 'x' } }, tender: tender('t1') };
  const z2 = { zmiana: { id: 'b', typ: 'wartosc', ton: 'ostrzezenie', opis: { pl: 'y', en: 'y' } }, tender: tender('t2') };

  assert.equal(
    zbudujAlertZmian({ wyszukiwanie: WYSZUKIWANIE, trafienia: [z1, z2] }).klucz,
    zbudujAlertZmian({ wyszukiwanie: WYSZUKIWANIE, trafienia: [z2, z1] }).klucz,
  );
});

test('treść push niesie typ i identyfikatory potrzebne do nawigacji w aplikacji', () => {
  const alert = zbudujAlertNowych({ wyszukiwanie: WYSZUKIWANIE, pozycje: [tender('t1')] });
  const push = trescPush(alert);

  assert.ok(push.title.length > 0 && push.body.length > 0);
  assert.equal(push.data.type, 'nowe_trafienia');
  assert.equal(push.data.wyszukiwanie_id, 'w1');
  assert.equal(typeof push.data.klucz, 'string');
});

test('okno odczytu zmian sięga do NAJSTARSZEGO sprawdzenia w partii, ale nie w nieskończoność', () => {
  const wpisy = [
    { ostatnio_sprawdzone_o: '2026-09-24T10:00:00.000Z' },
    { ostatnio_sprawdzone_o: '2026-09-23T10:00:00.000Z' },
  ];
  assert.equal(oknoOdczytuZmian(wpisy, '2026-09-24T12:00:00.000Z'), '2026-09-23T10:00:00.000Z');

  // Wyszukiwanie porzucone na miesiąc nie może kazać czytać miesiąca zmian.
  const stare = [{ ostatnio_sprawdzone_o: '2026-01-01T00:00:00.000Z' }];
  const granica = new Date(Date.parse('2026-09-24T12:00:00.000Z') - MAKS_DNI_WSTECZ * 86_400_000).toISOString();
  assert.equal(oknoOdczytuZmian(stare, '2026-09-24T12:00:00.000Z'), granica);

  // Same pierwsze przebiegi — nie ma po co czytać historii w ogóle.
  assert.equal(oknoOdczytuZmian([{ ostatnio_sprawdzone_o: null }], '2026-09-24T12:00:00.000Z'), null);
});
