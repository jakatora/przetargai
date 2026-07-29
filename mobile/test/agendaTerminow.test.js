import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujAgende, GRUPY_AGENDY } from '../src/lib/agendaTerminow.js';

/*
 * Agenda terminów — grupowanie i sortowanie zapisanych przetargów po terminie.
 * Czas wstrzykiwany, więc test jest deterministyczny. Klasyfikacja stanu pochodzi
 * z opisTerminu (osobno testowany), tu sprawdzamy oś: kolejność, grupy, filtr braku terminu.
 */

const TERAZ = Date.parse('2026-06-15T09:00:00Z');
const wpis = (id, deadline, extra = {}) => ({
  id,
  tender: { id: `t-${id}`, title: `Przetarg ${id}`, organization: 'Gmina', deadline },
  ...extra,
});

test('grupuje po pilności w stałej kolejności i sortuje chronologicznie', () => {
  const saved = [
    wpis('odlegly', '2026-07-05T09:00:00Z'), // +20 dni → pozniej
    wpis('przeszly', '2026-06-10T09:00:00Z'), // minął → poTerminie
    wpis('dzis', '2026-06-15T20:00:00Z'), // ~11 godz → dzis
    wpis('tydzien', '2026-06-20T09:00:00Z'), // +5 dni → tydzien
    wpis('jutro', '2026-06-17T09:00:00Z'), // +2 dni → dzis (grupa „Dziś i jutro")
    wpis('bezTerminu', null), // brak terminu → pomijamy
  ];

  const { grupy, licznik } = zbudujAgende(saved, TERAZ);

  assert.equal(licznik, 5, 'wpis bez terminu nie liczy się do agendy');
  assert.deepEqual(grupy.map((g) => g.klucz), ['poTerminie', 'dzis', 'tydzien', 'pozniej'],
    'grupy w stałej kolejności, puste pominięte');

  const dzis = grupy.find((g) => g.klucz === 'dzis');
  assert.deepEqual(dzis.pozycje.map((p) => p.id), ['dzis', 'jutro'],
    'w grupie sortowanie chronologiczne (najbliższy termin pierwszy)');
  assert.equal(dzis.pozycje[0].pilny, true);
});

test('same przetargi bez terminu → pusta agenda (nie ma czego układać)', () => {
  const { grupy, licznik } = zbudujAgende([wpis('a', null), wpis('b', undefined)], TERAZ);
  assert.equal(licznik, 0);
  assert.equal(grupy.length, 0);
});

test('pozycja niesie źródłowy wpis do nawigacji + etykietę czasu', () => {
  const saved = [wpis('x', '2026-06-16T09:00:00Z')];
  const { grupy } = zbudujAgende(saved, TERAZ);
  const p = grupy[0].pozycje[0];
  assert.equal(p.zrodlo.id, 'x', 'zrodlo = pełny wpis (ekran nawiguje z { match: zrodlo })');
  assert.equal(p.tenderId, 't-x');
  assert.ok(typeof p.etykietaCzasu === 'string' && p.etykietaCzasu.length > 0);
});

test('wejście puste/niepoprawne nie wywraca funkcji', () => {
  assert.deepEqual(zbudujAgende(null, TERAZ), { grupy: [], licznik: 0 });
  assert.deepEqual(zbudujAgende(undefined, TERAZ), { grupy: [], licznik: 0 });
  assert.equal(GRUPY_AGENDY.length, 4);
});
