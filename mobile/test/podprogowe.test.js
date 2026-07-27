import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ETYKIETY_ZRODEL,
  etykietaZrodla,
  flagiPodprogowe,
  etykietaWartosciNetto,
  sortujPodprogowe,
} from '../src/lib/podprogowe.js';

/*
 * Radar zamówień podprogowych — panel mobilny (podzadanie 7/7). Czysta logika
 * „liczba/kod → słowo" i sortowanie scalonego strumienia. Bez Reacta — ekran
 * PodprogoweDetail / band w MatchFeedScreen tylko renderuje to, co tu policzone.
 */

// ---------------- etykiety źródeł ----------------

test('etykietaZrodla: każdy kod źródła ma ludzką etykietę', () => {
  assert.equal(etykietaZrodla('bzp_wylaczone'), ETYKIETY_ZRODEL.bzp_wylaczone);
  assert.equal(etykietaZrodla('platformazakupowa'), 'platformazakupowa.pl');
  assert.equal(etykietaZrodla('ezamawiajacy'), 'eZamawiający');
  assert.equal(etykietaZrodla('epropublico'), 'e-propublico');
  assert.equal(etykietaZrodla('baza_konkurencyjnosci'), 'Baza Konkurencyjności');
  assert.equal(etykietaZrodla('bip'), 'BIP');
});

test('etykietaZrodla: nieznany kod → fallback, pusty → „Inne źródło"', () => {
  assert.equal(etykietaZrodla('cokolwiek'), 'cokolwiek');
  assert.equal(etykietaZrodla(''), 'Inne źródło');
  assert.equal(etykietaZrodla(null), 'Inne źródło');
  assert.equal(etykietaZrodla(undefined), 'Inne źródło');
});

// ---------------- flagi „łatwiejszego startu" ----------------

test('flagiPodprogowe: tylko flagi true, w stałej kolejności', () => {
  assert.deepEqual(
    flagiPodprogowe({ bez_wadium: true, bez_kio: true, prosta_procedura: true }).map((f) => f.etykieta),
    ['bez wadium', 'bez KIO', 'prosta procedura'],
  );
  // Kolejność stała niezależnie od kolejności kluczy w obiekcie.
  assert.deepEqual(
    flagiPodprogowe({ prosta_procedura: true, bez_wadium: true }).map((f) => f.klucz),
    ['bez_wadium', 'prosta_procedura'],
  );
});

test('flagiPodprogowe: brak/puste/false → pusta lista', () => {
  assert.deepEqual(flagiPodprogowe({}), []);
  assert.deepEqual(flagiPodprogowe(null), []);
  assert.deepEqual(flagiPodprogowe(undefined), []);
  assert.deepEqual(flagiPodprogowe({ bez_wadium: false, bez_kio: false }), []);
});

// ---------------- wartość netto ----------------

test('etykietaWartosciNetto: kwota z separatorem tysięcy + „netto"', () => {
  assert.equal(etykietaWartosciNetto(120000), '120 000 PLN netto');
  assert.equal(etykietaWartosciNetto(169000, 'PLN'), '169 000 PLN netto');
  assert.equal(etykietaWartosciNetto(80000, 'EUR'), '80 000 EUR netto');
});

test('etykietaWartosciNetto: brak/NaN → null (nie pokazujemy „0")', () => {
  assert.equal(etykietaWartosciNetto(null), null);
  assert.equal(etykietaWartosciNetto(undefined), null);
  assert.equal(etykietaWartosciNetto(Number.NaN), null);
});

// ---------------- sortowanie scalonego strumienia ----------------

const now = '2026-07-27T00:00:00.000Z';
const O = (id, { ls = false, termin = null, pub = null } = {}) => ({
  id,
  latwiejszy_start: ls,
  termin_skladania: termin,
  data_publikacji: pub,
  created_at: pub,
});

test('sortujPodprogowe: „łatwiejszy start" zawsze na górze, mimo dalszego terminu', () => {
  const lista = [
    O('a', { ls: false, termin: '2026-07-28T00:00:00.000Z' }), // bliżej, ale nie ls
    O('b', { ls: true, termin: '2026-08-30T00:00:00.000Z' }),  // dalej, ale ls
  ];
  assert.deepEqual(sortujPodprogowe(lista, now).map((o) => o.id), ['b', 'a']);
});

test('sortujPodprogowe: w obrębie grupy — najbliższy OTWARTY termin, potem bez terminu, na końcu miniony', () => {
  const lista = [
    O('p1', { ls: true, termin: '2026-08-10T00:00:00.000Z' }),
    O('p2', { ls: true, termin: '2026-07-30T00:00:00.000Z' }),
    O('p3', { ls: true, termin: null }),
    O('p4', { ls: true, termin: '2020-01-01T00:00:00.000Z' }), // miniony
  ];
  assert.deepEqual(sortujPodprogowe(lista, now).map((o) => o.id), ['p2', 'p1', 'p3', 'p4']);
});

test('sortujPodprogowe: przy równym terminie — najnowsza publikacja pierwsza', () => {
  const lista = [
    O('x', { ls: true, termin: null, pub: '2026-07-01T00:00:00.000Z' }),
    O('y', { ls: true, termin: null, pub: '2026-07-20T00:00:00.000Z' }),
  ];
  assert.deepEqual(sortujPodprogowe(lista, now).map((o) => o.id), ['y', 'x']);
});

test('sortujPodprogowe: NIE mutuje wejścia', () => {
  const lista = [O('a', { ls: true }), O('b', { ls: false })];
  const kopia = JSON.parse(JSON.stringify(lista));
  sortujPodprogowe(lista, now);
  assert.deepEqual(lista, kopia);
});

test('sortujPodprogowe: brak danych → pusta tablica', () => {
  assert.deepEqual(sortujPodprogowe([], now), []);
  assert.deepEqual(sortujPodprogowe(undefined, now), []);
  assert.deepEqual(sortujPodprogowe(null, now), []);
});
