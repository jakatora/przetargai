import { test } from 'node:test';
import assert from 'node:assert/strict';

import { banerWezwania } from '../src/lib/wezwanieUzupelnienie.js';

/*
 * Baner wezwania w Kalendarzu terminów — aktywne wezwanie ma być widoczne obok
 * terminów składania, nie tylko na własnym ekranie.
 */
const TERAZ = Date.parse('2026-10-24T10:00:00Z');

test('aktywne wezwanie z checklistą: pokaż z odliczaniem i licznikiem dokumentów', () => {
  const b = banerWezwania({ termin: '2026-10-27', dokumenty: [{ nazwa: 'ZUS', gotowy: true }, { nazwa: 'KRK', gotowy: false }] }, TERAZ);
  assert.equal(b.pokaz, true);
  assert.match(b.etykieta, /^Wezwanie: Zostało/);
  assert.match(b.etykieta, /dokumenty 1\/2/);
  assert.equal(b.brakujace, 1);
  assert.equal(b.ton, 'neutral');
});

test('ostatnia doba = danger; po terminie do 7 dni nadal widoczne jako danger; starsze znika', () => {
  assert.equal(banerWezwania({ termin: '2026-10-24' }, TERAZ).ton, 'danger');
  const po = banerWezwania({ termin: '2026-10-22' }, TERAZ);
  assert.equal(po.pokaz, true);
  assert.equal(po.ton, 'danger');
  assert.match(po.etykieta, /PO TERMINIE/);
  assert.equal(banerWezwania({ termin: '2026-10-10' }, TERAZ).pokaz, false);
});

test('brak terminu albo śmieci → nie pokazuj, nie rzuca', () => {
  assert.equal(banerWezwania({ dokumenty: [{ nazwa: 'x' }] }, TERAZ).pokaz, false);
  assert.equal(banerWezwania(null, TERAZ).pokaz, false);
  assert.equal(banerWezwania({ termin: '10.06.2026' }, TERAZ).pokaz, false, 'nieczytelny zapis = nieznany termin');
});
