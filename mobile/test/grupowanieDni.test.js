import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grupujPoDniach, etykietaDnia, czyNowe, policzNowe } from '../src/lib/grupowanieDni.js';

// Punkt odniesienia: 2026-07-31 12:00 czasu lokalnego.
const TERAZ = new Date(2026, 6, 31, 12, 0, 0).getTime();
const iso = (r, m, d, h = 10) => new Date(r, m, d, h).toISOString();

test('etykietaDnia: Dziś / Wczoraj / data / data z rokiem', () => {
  const teraz = new Date(TERAZ);
  assert.equal(etykietaDnia(new Date(2026, 6, 31, 9), teraz), 'Dziś');
  assert.equal(etykietaDnia(new Date(2026, 6, 30, 9), teraz), 'Wczoraj');
  assert.equal(etykietaDnia(new Date(2026, 6, 28, 9), teraz), '28 lipca');
  assert.equal(etykietaDnia(new Date(2025, 6, 28, 9), teraz), '28 lipca 2025');
});

test('grupujPoDniach: sekcje od najnowszego dnia, kolejność w dniu zachowana', () => {
  const matches = [
    { id: 'a', created_at: iso(2026, 6, 31, 11) },
    { id: 'b', created_at: iso(2026, 6, 31, 9) },
    { id: 'c', created_at: iso(2026, 6, 30, 15) },
    { id: 'd', created_at: iso(2026, 6, 28, 8) },
  ];
  const s = grupujPoDniach(matches, TERAZ);
  assert.deepEqual(s.map((x) => x.tytul), ['Dziś', 'Wczoraj', '28 lipca']);
  assert.deepEqual(s[0].data.map((m) => m.id), ['a', 'b']); // kolejność wejścia zachowana
  assert.equal(s[1].data.length, 1);
});

test('grupujPoDniach: rekordy bez daty na końcu jako „Wcześniej"', () => {
  const s = grupujPoDniach([
    { id: 'a', created_at: iso(2026, 6, 31) },
    { id: 'x', created_at: null },
  ], TERAZ);
  assert.equal(s[s.length - 1].tytul, 'Wcześniej');
  assert.equal(s[s.length - 1].data[0].id, 'x');
});

test('czyNowe / policzNowe: liczy dodane po ostatniej wizycie', () => {
  const wizyta = new Date(2026, 6, 30, 12).getTime();
  const matches = [
    { id: 'a', created_at: iso(2026, 6, 31, 11) }, // nowe
    { id: 'b', created_at: iso(2026, 6, 31, 9) },  // nowe
    { id: 'c', created_at: iso(2026, 6, 29, 15) }, // stare
  ];
  assert.equal(czyNowe(matches[0], wizyta), true);
  assert.equal(czyNowe(matches[2], wizyta), false);
  assert.equal(policzNowe(matches, wizyta), 2);
});

test('policzNowe: brak ostatniej wizyty → 0 (pierwsze uruchomienie nic nie krzyczy)', () => {
  assert.equal(policzNowe([{ created_at: iso(2026, 6, 31) }], 0), 0);
});

test('grupujPoDniach: nowe zliczane per sekcja', () => {
  const wizyta = new Date(2026, 6, 30, 23).getTime();
  const s = grupujPoDniach([
    { id: 'a', created_at: iso(2026, 6, 31, 11) },
    { id: 'b', created_at: iso(2026, 6, 31, 9) },
    { id: 'c', created_at: iso(2026, 6, 30, 8) },
  ], TERAZ, wizyta);
  assert.equal(s[0].nowe, 2); // Dziś: oba nowe
  assert.equal(s[1].nowe, 0); // Wczoraj: sprzed wizyty
});
