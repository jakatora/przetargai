import { test } from 'node:test';
import assert from 'node:assert/strict';

import { znajdzPonowne, alertPonownego } from '../src/lib/ponowneOgloszenie.js';
import { runPonowneOgloszenia } from '../src/jobs/ponowneOgloszenia.js';

/*
 * Unieważniony przetarg ogłoszony ponownie (2026-11-01): ten sam zamawiający, nowe otwarte ogłoszenie po terminie
 * starego, podobny tytuł i ten sam dział CPV — alert i zapis nowego ogłoszenia kontu.
 */
const TERAZ = Date.parse('2026-11-01T10:00:00Z');
const stary = { id: 'bzp_1', title: 'Przebudowa drogi gminnej nr 108455R w miejscowości Albigowa', organization: 'Gmina Łańcut', deadline: '2026-09-20T08:00:00.000Z', cpv_main: '45233140-2', zamawiajacy_nip: '7941804230', postepowanie_id: 'ocds-148610-aaa' };
const nowy = { id: 'bzp_2', title: 'Przebudowa drogi gminnej nr 108455R w miejscowości Albigowa – postępowanie II', deadline: '2026-11-20T08:00:00.000Z', published_at: '2026-10-28T10:00:00.000Z', cpv_main: '45233140-2', source: 'bzp' };

test('znajduje nowe ogłoszenie: podobny tytuł, po terminie starego, ten sam dział; inne i stare odpadają', () => {
  const kandydaci = [
    stary,
    { ...nowy, id: 'bzp_3', title: 'Dostawa oleju opałowego dla szkół', cpv_main: '09135100-5' },
    { ...nowy, id: 'bzp_4', published_at: '2026-08-01T00:00:00.000Z' },
    { ...nowy, id: 'bzp_5', deadline: '2026-10-01T00:00:00.000Z' },
    { ...nowy, id: 'bzp_6', cpv_main: '71320000-7' },
    nowy,
  ];
  const w = znajdzPonowne(stary, kandydaci, { teraz: TERAZ });
  assert.equal(w.tender.id, 'bzp_2');
  assert.ok(w.podobienstwo >= 0.5);
  assert.equal(znajdzPonowne(stary, kandydaci.slice(0, 5), { teraz: TERAZ }), null);
});

test('alert: tytuł, termin nowego, dopisek o zapisie; klucz stary × nowy', () => {
  const a = alertPonownego({ stary, nowy, zapisano: true });
  assert.equal(a.typ, 'przetarg_ponownie');
  assert.equal(a.klucz, 'ponownie_bzp_1_bzp_2');
  assert.match(a.tytul.pl, /^Unieważniony przetarg wraca: Przebudowa drogi gminnej/);
  assert.match(a.tresc.pl, /Gmina Łańcut ogłosił go ponownie — oferty do 20\.11\.2026\..* Dodaliśmy go do Zapisanych z przypomnieniem\./);
});

test('job: tylko unieważnione (wszystkie części) po terminie; zapis i alert raz na konto', async () => {
  const dodane = new Set();
  const zapisy = [];
  const deps = {
    teraz: TERAZ,
    zapisane: { otwarteWszystkich: async () => [{ userId: 'u1', tenderId: 'bzp_1' }, { userId: 'u1', tenderId: 'bzp_9' }], zaangazowaneWszystkich: async () => [{ userId: 'u2', tenderId: 'bzp_1' }] },
    przetargi: {
      polaWielu: async () => [stary, { ...stary, id: 'bzp_9', postepowanie_id: 'ocds-148610-bbb' }],
      poNipieZamawiajacego: async () => [stary, nowy],
      poNazwieZamawiajacego: async () => [],
      findById: async (id) => (id === 'bzp_2' ? nowy : null),
    },
    wyniki: { poPostepowaniu: async (id) => (id === 'ocds-148610-aaa' ? { czesci: [{ uniewaznione: true }, { uniewaznione: true }] } : { czesci: [{ uniewaznione: false }] }) },
    konta: { findById: async (id) => ({ id, email: `${id}@t.pl` }) },
    alertyRepo: { dodaj: async (uid, alert) => { const k = `${uid}/${alert.klucz}`; const n = !dodane.has(k); dodane.add(k); return { nowy: n }; } },
    wyslijPush: async () => ({ sent: 1 }), wyslijEmail: async () => {},
    zapisz: async (uid, t) => { zapisy.push([uid, t.id]); return { zapisany: true }; },
  };
  const w = await runPonowneOgloszenia(deps);
  assert.deepEqual([w.po_terminie, w.uniewaznione, w.ponowne, w.alerty, w.zapisane], [2, 1, 1, 2, 2]);
  assert.deepEqual(zapisy, [['u1', 'bzp_2'], ['u2', 'bzp_2']]);
  const w2 = await runPonowneOgloszenia(deps);
  assert.equal(w2.alerty, 0);
});
