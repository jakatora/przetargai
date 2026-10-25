import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, oknoPz } = await import('../src/db/repos.js');
const { runOknoPz } = await import('../src/jobs/oknoPlatformaZakupowa.js');

const FIXTURE = readFileSync(new URL('./fixtures/platformazakupowa-lista.html', import.meta.url), 'utf8');
const ZNAK = `${process.pid}${Date.now()}`.slice(-7);
// Unikalne id w emulatorze (test współdzieli bazę z innymi plikami).
const fixtureZ = (przesuniecie = 0, termin = null) => FIXTURE
  .replace(/\/transakcja\/(\d+)/g, (_, id) => `/transakcja/${ZNAK}${Number(id) + przesuniecie}`)
  .replace(/countdown-(\d+)/g, (_, id) => `countdown-${ZNAK}${Number(id) + przesuniecie}`)
  .replace(/\(ID (\d+)\)/g, (_, id) => `(ID ${ZNAK}${Number(id) + przesuniecie})`)
  .replace(/25-10-2026 15:52:00/g, termin ?? '25-10-2026 15:52:00');
// Strona „pełna" = 100 pozycji; próbka ma 3, więc symulujemy koniec listy po pierwszej stronie.

test('przebieg: 3 nowe ogłoszenia z listy, kursor wraca na 1 po niepełnej stronie, ślad przebiegu zapisany', async () => {
  await oknoPz.zapisz({ nastepna_strona: 5 });
  const zadania = [];
  const fetchFn = async (url) => { zadania.push(url); return { ok: true, text: async () => fixtureZ() }; };
  const w = await runOknoPz({ fetchFn, odstepMs: 0, teraz: () => '2026-10-25T16:00:00.000Z' });
  assert.equal(w.ok, true);
  assert.deepEqual(w.strony, [5], 'niepełna strona kończy przebieg');
  assert.equal(w.nowe, 3);
  assert.equal(w.nastepna_strona, 1);
  assert.equal(w.zapytania, 1);
  assert.match(zadania[0], /page=5&limit=100/);
  const t = await tenders.findById(`pz:${ZNAK}1390256`);
  assert.equal(t.source, 'platformazakupowa');
  assert.equal(t.title, 'Fartuchy foliowe do branży spożywczej');
  assert.equal(t.deadline, '2026-10-25T14:52:00.000Z');
  assert.equal(t.url, `https://platformazakupowa.pl/transakcja/${ZNAK}1390256`);
  assert.equal((await oknoPz.wczytaj()).nastepna_strona, 1);
  assert.equal((await oknoPz.wczytaj()).ostatni_przebieg.nowe, 3);
});

test('drugi przebieg: bez zmian nic nie zapisuje; przedłużony termin dociąga zaktualizujZeZrodla', async () => {
  const bezZmian = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => fixtureZ() }), odstepMs: 0 });
  assert.deepEqual([bezZmian.nowe, bezZmian.zaktualizowane, bezZmian.bez_zmian], [0, 0, 3]);
  const przedluzony = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => fixtureZ(0, '30-10-2026 10:00:00') }), odstepMs: 0 });
  assert.deepEqual([przedluzony.nowe, przedluzony.zaktualizowane], [0, 1]);
  assert.equal((await tenders.findById(`pz:${ZNAK}1390256`)).deadline, '2026-10-30T09:00:00.000Z');
});

test('403 ze źródła: przebieg ok=false, kursor zostaje, ślad z błędem', async () => {
  await oknoPz.zapisz({ nastepna_strona: 3 });
  const w = await runOknoPz({ fetchFn: async () => ({ ok: false, status: 403, text: async () => '' }), odstepMs: 0 });
  assert.equal(w.ok, false);
  assert.match(w.error, /403/);
  assert.equal(w.nastepna_strona, 3);
  assert.equal((await oknoPz.wczytaj()).nastepna_strona, 3);
});
