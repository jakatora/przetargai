import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Zadanie odbić na emulatorze (2026-11-07): stronicowanie listy Resend do granicy okna, zapis odbitych adresów
 * (drugi przebieg nie liczy ich jako nowe), ślad w `_health/maile_odbicia`; błąd API = ok:false bez rzucania.
 */
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { odbiteAdresy, stanOdbic } = await import('../src/db/repos.js');
const { runOdbiciaMaili } = await import('../src/jobs/odbiciaMaili.js');

const Z = `${process.pid}${Date.now()}`.slice(-7);
const TERAZ = '2026-11-07T14:00:00.000Z';
const m = (id, to, ev, czas) => ({ id, to: [to], last_event: ev, created_at: czas });
const STRONY = {
  '': { has_more: true, data: [m('a', `klient${Z}@gmail.com`, 'delivered', '2026-11-07 11:00:00+00'), m('b', `qa${Z}@test.pl`, 'bounced', '2026-11-07 10:00:00+00')] },
  b: { has_more: true, data: [m('c', `demo${Z}@przetargai.pl`, 'bounced', '2026-11-06 11:00:00+00'), m('d', `stary${Z}@x.pl`, 'bounced', '2026-11-01 11:00:00+00')] },
  d: { has_more: false, data: [m('e', `bardzo-stary${Z}@x.pl`, 'bounced', '2026-10-01 11:00:00+00')] },
};

test('stronicuje do granicy okna, zapisuje odbite, liczy dobę; drugi przebieg bez nowych', async () => {
  const pytania = [];
  const fetchFn = async (url) => {
    pytania.push(url);
    const after = new URL(url).searchParams.get('after') ?? '';
    return { ok: true, json: async () => STRONY[after] };
  };
  const w = await runOdbiciaMaili({ teraz: TERAZ, godzin: 48, fetchFn, klucz: 're_test' });
  assert.equal(w.ok, true);
  assert.equal(pytania.length, 2, 'druga strona sięga za okno 48 h — trzeciej nie czytamy');
  assert.deepEqual([w.maili, w.odbite_adresy, w.nowe_adresy, w.maili_24h, w.odbite_24h, w.odsetek], [3, 2, 2, 2, 1, 0.5]);
  assert.equal(await odbiteAdresy.czy(`QA${Z}@test.pl`), true);
  assert.equal(await odbiteAdresy.czy(`stary${Z}@x.pl`), false, 'poza oknem');
  assert.equal(await odbiteAdresy.czy(`klient${Z}@gmail.com`), false);
  assert.equal((await stanOdbic.wczytaj()).ostatni_przebieg.odbite_24h, 1);

  const drugi = await runOdbiciaMaili({ teraz: TERAZ, godzin: 48, fetchFn, klucz: 're_test' });
  assert.equal(drugi.nowe_adresy, 0);
});

test('błąd API: ok:false z opisem, bez rzucania; brak klucza — od razu', async () => {
  const w = await runOdbiciaMaili({ teraz: TERAZ, fetchFn: async () => ({ ok: false, status: 401 }), klucz: 're_test' });
  assert.equal(w.ok, false);
  assert.match(w.error, /401/);
  assert.equal((await runOdbiciaMaili({ teraz: TERAZ, klucz: '' })).error, 'brak RESEND_API_KEY');
});
