import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zbudujPlanDzialania } from '../src/lib/planDzialania.js';

const TERAZ = Date.parse('2026-10-21T10:00:00.000Z');
const MATCH = { id: 'm1', tender_id: 't1', tender: { id: 't1', title: 'Remont dachu', deadline: '2026-11-10T10:00:00.000Z',
  wadium_wymagane: true, wadium_kwota: 5000, kryterium_oceny: 'cena_i_jakosc' } };

test('pełny plan: kolejność kroków, terminy, ekrany istniejące w nawigacji', () => {
  const plan = zbudujPlanDzialania({ match: MATCH, terminPytan: '2026-11-06T10:00:00.000Z', teraz: TERAZ });
  assert.deepEqual(plan.map((k) => k.klucz), ['decyzja', 'swz', 'pytania', 'dokumenty', 'wadium', 'cena', 'kontrola', 'zlozenie']);
  assert.equal(plan.find((k) => k.klucz === 'wadium').tytul.pl, 'Wnieś wadium 5 000 zł');
  assert.equal(plan.find((k) => k.klucz === 'cena').ekran, 'KalkulatorPunktow');
  assert.equal(plan.find((k) => k.klucz === 'kontrola').termin, '2026-11-09T10:00:00.000Z');
  assert.ok(plan.every((k) => typeof k.ekran === 'string'));
});

test('bez wadium i bez terminu pytań — te kroki znikają; sama cena → KalkulatorCeny', () => {
  const m = { ...MATCH, tender: { ...MATCH.tender, wadium_wymagane: false, kryterium_oceny: 'tylko_cena' } };
  const plan = zbudujPlanDzialania({ match: m, teraz: TERAZ });
  assert.ok(!plan.some((k) => k.klucz === 'wadium' || k.klucz === 'pytania'));
  assert.equal(plan.find((k) => k.klucz === 'cena').ekran, 'KalkulatorCeny');
});

test('odhaczanie z postępu klienta: SWZ powiązana, etap „złożona”', () => {
  const plan = zbudujPlanDzialania({ match: MATCH, swzPowiazana: true, etap: 'zlozona', teraz: TERAZ });
  for (const k of ['decyzja', 'swz', 'zlozenie']) assert.equal(plan.find((x) => x.klucz === k).wykonany, true, k);
});

test('termin pytań minął → minal; krok z terminem w 2 dni → pilny', () => {
  const plan = zbudujPlanDzialania({ match: { ...MATCH, tender: { ...MATCH.tender, deadline: '2026-10-22T20:00:00.000Z' } },
    terminPytan: '2026-10-18T10:00:00.000Z', teraz: TERAZ });
  assert.equal(plan.find((k) => k.klucz === 'pytania').minal, true);
  assert.equal(plan.find((k) => k.klucz === 'zlozenie').pilny, true);
});

test('przetarg bez terminu: plan bez dat, nic nie jest pilne', () => {
  const plan = zbudujPlanDzialania({ match: { ...MATCH, tender: { ...MATCH.tender, deadline: null } }, teraz: TERAZ });
  assert.ok(plan.filter((k) => k.klucz !== 'decyzja').every((k) => k.termin === null && !k.pilny));
});
