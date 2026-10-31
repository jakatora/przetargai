import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, oknoLt } = await import('../src/db/repos.js');
const { runOknoLt } = await import('../src/jobs/oknoLogintrade.js');

const LISTA = readFileSync(new URL('./fixtures/logintrade-lista.html', import.meta.url), 'utf8');
const SZCZEGOL = readFileSync(new URL('./fixtures/logintrade-szczegol.html', import.meta.url), 'utf8');
const ZNAK = `${process.pid}${Date.now()}`.slice(-6);
// Unikalne id zapytań w tym przebiegu testów: 1670248 → 9<ZNAK>48 itd.
const listaZ = (zamiany = (s) => s) => zamiany(LISTA.replace(/zapytania_email,1670(\d{3})/g, `zapytania_email,9${ZNAK}$1`));
const HOST = 'platformazakupowa.grupaazoty.com';
const id = (koncowka, cyfra = '9') => `lt:${HOST}:${cyfra}${ZNAK}${koncowka}`;
const serwer = ({ lista = listaZ(), szczegol = SZCZEGOL, bladKarty = false } = {}) => {
  const wywolania = [];
  const fn = async (url) => {
    wywolania.push(url);
    if (/zapytania_email,/.test(url)) return bladKarty ? { ok: false, status: 500, text: async () => '' } : { ok: true, text: async () => szczegol };
    const strona = Number((url.match(/page=(\d+)/) || [])[1] || 1);
    return { ok: true, text: async () => (strona === 1 ? lista : '<table class="defaultTable"></table>') };
  };
  fn.wywolania = wywolania;
  return fn;
};

test('przebieg: 3 aktywne z kartą zapisane (kupiec, NIP, termin z godziną), nieaktywne pominięte, ślad przebiegu', async () => {
  const fetchFn = serwer();
  const w = await runOknoLt({ fetchFn, odstepMs: 0, teraz: () => '2026-10-31T10:00:00.000Z' });
  assert.equal(w.ok, true);
  assert.equal(w.strony, 1);
  assert.deepEqual([w.nowe, w.szczegoly, w.bledy_szczegolu], [3, 3, 0]);
  assert.equal(w.zapytania, 2 + 3, '2 strony listy (druga pusta) + 3 karty');
  const t = await tenders.findById(id('248'));
  assert.equal(t.source, 'logintrade');
  assert.equal(t.organization, 'Grupa Azoty Zakłady Fosforowe Gdańsk sp. z o.o.');
  assert.equal(t.zamawiajacy_nip, '5830001675');
  assert.equal(t.deadline, '2026-11-13T15:00:00.000Z');
  assert.equal(t.wojewodztwo, 'PL22');
  assert.ok(t.klucz_dedup);
  assert.equal(await tenders.findById(id('793')), null, 'nieaktywne zapytanie nie powstało');
  assert.equal((await oknoLt.wczytaj()).ostatni_przebieg.nowe, 3);
});

test('drugi przebieg: istniejące bez kart; inny dzień terminu na liście → karta i nowy termin', async () => {
  // Dzień z listy zapamiętany przy zapisie — mimo wspólnej karty (13.11) wiersze z innym dniem nie pobierają jej ponownie.
  const w = await runOknoLt({ fetchFn: serwer(), odstepMs: 0 });
  assert.deepEqual([w.nowe, w.szczegoly, w.bez_zmian, w.zaktualizowane], [0, 0, 3, 0]);
  assert.equal((await tenders.findById(id('248'))).lt_dzien_listy, '2026-11-13');
  // Pierwszy wiersz: lista mówi 2026-11-20, karta — 20.11 o 12:30.
  const lista = listaZ((s) => s.replace('<td >2026-11-13</td>', '<td >2026-11-20</td>'));
  const szczegol = SZCZEGOL.replace('name="data_dzien" readonly class="kalendarz" value="13"', 'name="data_dzien" readonly class="kalendarz" value="20"')
    .replace('name="godz_godz" readonly class="kalendarz" value="16"', 'name="godz_godz" readonly class="kalendarz" value="12"')
    .replace('name="godz_min" readonly class="kalendarz" value="00"', 'name="godz_min" readonly class="kalendarz" value="30"');
  const w2 = await runOknoLt({ fetchFn: serwer({ lista, szczegol }), odstepMs: 0 });
  assert.deepEqual([w2.zaktualizowane, w2.szczegoly, w2.bez_zmian], [1, 1, 2]);
  assert.equal((await tenders.findById(id('248'))).deadline, '2026-11-20T11:30:00.000Z');
});

test('karta niedostępna → zapytanie NIE powstaje (bez godziny terminu), wraca w kolejnym przebiegu; budżet kart → odłożone', async () => {
  const lista = listaZ((s) => s.replace(new RegExp(`9${ZNAK}`, 'g'), `8${ZNAK}`));
  const w = await runOknoLt({ fetchFn: serwer({ lista, bladKarty: true }), odstepMs: 0 });
  assert.deepEqual([w.nowe, w.bledy_szczegolu], [0, 3]);
  assert.equal(await tenders.findById(id('248', '8')), null);
  const w2 = await runOknoLt({ fetchFn: serwer({ lista }), odstepMs: 0, maksSzczegolow: 1 });
  assert.deepEqual([w2.nowe, w2.odlozone], [1, 2]);
});

test('rejestr wiodący (BZP) o tym samym kluczu → link poboczny zamiast kopii', async () => {
  const { tender: bzp } = await tenders.upsert({
    externalId: `bzp-lt-${ZNAK}`, title: '46/NM/PM/2026 Wykonanie przeglądów / napraw wagonów kolejowych Grupy Azoty "FOSFORY" Sp. z o.o. w Gdańsku',
    organization: 'Grupa Azoty Zakłady Fosforowe Gdańsk sp. z o.o.', deadline: '2026-11-13T15:00:00.000Z', source: 'bzp', url: 'https://ezamowienia.gov.pl/x',
  });
  const lista = listaZ((s) => s.replace(new RegExp(`9${ZNAK}`, 'g'), `7${ZNAK}`));
  const w = await runOknoLt({ fetchFn: serwer({ lista }), odstepMs: 0 });
  assert.equal(w.scalone_z_rejestrem >= 1, true);
  assert.equal(await tenders.findById(id('248', '7')), null, 'kopia z Logintrade NIE powstała');
  assert.equal((await tenders.findById(bzp.id)).zrodla_alternatywne[0].source, 'logintrade');
});

test('503 z listy: ok=false ze śladem', async () => {
  const w = await runOknoLt({ fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }), odstepMs: 0 });
  assert.equal(w.ok, false);
  assert.match(w.error, /503/);
});
