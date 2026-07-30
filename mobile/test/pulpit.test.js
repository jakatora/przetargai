import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujPulpit } from '../src/lib/pulpit.js';
import { STATUSY } from '../src/lib/statusPrzetargu.js';

const TERAZ = Date.parse('2026-06-15T09:00:00Z');
const wpis = (id, status, deadline) => ({ id, status, tender: { id: `t-${id}`, title: `Przetarg ${id}`, organization: 'Gmina', deadline } });

test('grupuje po etapach w kolejności STATUSY, tylko niepuste', () => {
  const saved = [
    wpis('a', 'zlozona', '2026-07-01T09:00:00Z'),
    wpis('b', 'rozwazam', '2026-06-20T09:00:00Z'),
    wpis('c', 'przygotowuje', '2026-06-18T09:00:00Z'),
    wpis('d', 'rozwazam', '2026-06-16T09:00:00Z'),
  ];
  const { grupy, lacznie } = zbudujPulpit(saved, TERAZ);
  assert.equal(lacznie, 4);
  // rozwazam, przygotowuje, zlozona (wygrana/przegrana puste → pominięte), w kolejności STATUSY
  assert.deepEqual(grupy.map((g) => g.wartosc), ['rozwazam', 'przygotowuje', 'zlozona']);
  const rozwazam = grupy.find((g) => g.wartosc === 'rozwazam');
  assert.equal(rozwazam.liczba, 2);
  assert.deepEqual(rozwazam.pozycje.map((p) => p.id), ['d', 'b'], 'w grupie sort po najbliższym terminie');
});

test('brak statusu → domyślny „rozważam"', () => {
  const { grupy } = zbudujPulpit([{ id: 'x', tender: { title: 'Bez statusu', deadline: null } }], TERAZ);
  assert.equal(grupy[0].wartosc, 'rozwazam');
});

test('„wymaga uwagi" liczy pilne otwarte (nie po wygranej/przegranej)', () => {
  const saved = [
    wpis('pilny-otwarty', 'przygotowuje', '2026-06-17T09:00:00Z'), // +2 dni → pilny ✓
    wpis('pilny-wygrana', 'wygrana', '2026-06-16T09:00:00Z'),       // pilny, ale wygrana → nie liczy
    wpis('odlegly', 'rozwazam', '2026-08-01T09:00:00Z'),            // nie pilny
    wpis('minal', 'zlozona', '2026-06-10T09:00:00Z'),               // minął → nie liczy
  ];
  const { wymagaUwagi } = zbudujPulpit(saved, TERAZ);
  assert.equal(wymagaUwagi, 1);
});

test('pozycja niesie źródło do nawigacji + etykietę czasu', () => {
  const { grupy } = zbudujPulpit([wpis('z', 'zlozona', '2026-06-16T09:00:00Z')], TERAZ);
  const p = grupy[0].pozycje[0];
  assert.equal(p.zrodlo.id, 'z');
  assert.ok(typeof p.etykietaCzasu === 'string' && p.etykietaCzasu.length > 0);
});

test('puste/niepoprawne wejście → zerowy pulpit', () => {
  assert.deepEqual(zbudujPulpit([], TERAZ), { grupy: [], lacznie: 0, wymagaUwagi: 0 });
  assert.deepEqual(zbudujPulpit(null, TERAZ), { grupy: [], lacznie: 0, wymagaUwagi: 0 });
  assert.equal(STATUSY.length, 5);
});
