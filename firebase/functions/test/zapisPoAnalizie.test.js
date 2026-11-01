import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zapiszPoAnalizieSwz } from '../src/services/zapisPoAnalizie.js';

/*
 * Zapis po analizie SWZ (2026-11-01): kto pyta o SWZ, ten szykuje ofertę — zapis + przypomnienie,
 * bez nadpisywania istniejącego wpisu; błąd zapisu nie psuje odpowiedzi o SWZ.
 */
const tender = { id: 'bzp_7', title: 'Remont drogi', organization: 'Gmina', deadline: '2026-11-20T08:00:00.000Z', source: 'bzp', kryteria: [{ nazwa: 'Cena', waga: 100, udzial: 100, rodzaj: 'cena' }] };

function repo({ istnieje = false, rzuca = false } = {}) {
  const wywolania = [];
  return {
    wywolania,
    dopasowania: { detail: async () => null },
    zapisane: {
      add: async (uid, wpis) => { if (rzuca) throw new Error('firestore'); wywolania.push(['add', uid, wpis]); return !istnieje; },
      setReminder: async (uid, id, on) => { wywolania.push(['remind', uid, id, on]); return { reminder_enabled: true }; },
    },
  };
}

test('nowy zapis z przetargu (spoza dopasowań) + włączone przypomnienie', async () => {
  const r = repo();
  assert.deepEqual(await zapiszPoAnalizieSwz('u1', tender, r), { zapisany: true, przypomnienie: true });
  const [, uid, wpis] = r.wywolania[0];
  assert.deepEqual([uid, wpis.tender_id, wpis.tender_title, wpis.tender_deadline, wpis.tender_source], ['u1', 'bzp_7', 'Remont drogi', tender.deadline, 'bzp']);
  assert.equal(wpis.tender_kryteria_skrot.kryteria.length, 1, 'skrót kryteriów jak w kopii dopasowania');
  assert.deepEqual(r.wywolania[1], ['remind', 'u1', 'bzp_7', true]);
});

test('już zapisany: bez ruszania przypomnienia; błąd zapisu → bez wyjątku', async () => {
  const r = repo({ istnieje: true });
  assert.deepEqual(await zapiszPoAnalizieSwz('u1', tender, r), { zapisany: false, przypomnienie: false });
  assert.equal(r.wywolania.filter((w) => w[0] === 'remind').length, 0);
  assert.deepEqual(await zapiszPoAnalizieSwz('u1', tender, repo({ rzuca: true })), { zapisany: false, przypomnienie: false });
  assert.deepEqual(await zapiszPoAnalizieSwz(null, tender, repo()), { zapisany: false, przypomnienie: false });
});
