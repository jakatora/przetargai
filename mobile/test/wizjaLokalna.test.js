import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wykryjWizje } from '../src/lib/wizjaLokalna.js';

test('wykryjWizje: obowiązkowa pod rygorem odrzucenia → danger', () => {
  const w = wykryjWizje('Zamawiający wymaga odbycia obowiązkowej wizji lokalnej pod rygorem odrzucenia oferty.');
  assert.equal(w.wystepuje, true);
  assert.equal(w.obowiazkowa, true);
  assert.equal(w.ton, 'danger');
  assert.match(w.etykieta, /OBOWIĄZKOWA/);
  assert.ok(w.dopasowania.length >= 1);
});

test('wykryjWizje: rozpoznaje art. 226 ust. 1 pkt 18 jako rygor', () => {
  const w = wykryjWizje('Oferta bez odbycia wizji lokalnej zostanie odrzucona na podstawie art. 226 ust. 1 pkt 18 Pzp.');
  assert.equal(w.obowiazkowa, true);
});

test('wykryjWizje: zalecana/możliwa → ostrzeżenie, nie danger', () => {
  const w = wykryjWizje('Zaleca się odbycie wizji lokalnej. Wizja lokalna jest możliwa w dni robocze.');
  assert.equal(w.obowiazkowa, false);
  assert.equal(w.mozliwa, true);
  assert.equal(w.ton, 'ostrzezenie');
});

test('wykryjWizje: wzmianka bez jasnego rygoru → ostrożne ostrzeżenie', () => {
  const w = wykryjWizje('W trakcie realizacji przewidziano wizję lokalną obiektu przez inspektora.');
  assert.equal(w.wystepuje, true);
  assert.equal(w.obowiazkowa, false);
  assert.equal(w.mozliwa, false);
  assert.equal(w.ton, 'ostrzezenie');
});

test('wykryjWizje: brak wzmianki → neutralny', () => {
  const w = wykryjWizje('Przedmiotem zamówienia jest dostawa materiałów biurowych do siedziby zamawiającego.');
  assert.equal(w.wystepuje, false);
  assert.equal(w.ton, 'neutral');
  assert.deepEqual(w.dopasowania, []);
});

test('wykryjWizje: śmieci/pusty → nie wywala', () => {
  assert.equal(wykryjWizje(null).wystepuje, false);
  assert.equal(wykryjWizje(undefined).wystepuje, false);
});
