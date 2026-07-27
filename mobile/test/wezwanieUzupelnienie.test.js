import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pozostalyCzas,
  statusChecklisty,
  podpowiedzDoDokumentu,
} from '../src/lib/wezwanieUzupelnienie.js';

const MS_GODZINA = 3600000;
const MS_DZIEN = 24 * MS_GODZINA;
const TERAZ = Date.UTC(2026, 0, 15, 10, 0, 0); // 15 stycznia 2026, 10:00 UTC

test('pozostalyCzas: 5 dni przed terminem = ton neutralny', () => {
  const r = pozostalyCzas(new Date(TERAZ + 5 * MS_DZIEN), TERAZ);
  assert.equal(r.znany, true);
  assert.equal(r.poTerminie, false);
  assert.equal(r.dni, 5);
  assert.equal(r.ton, 'neutral');
});

test('pozostalyCzas: mniej niż 3 dni = ostrzeżenie', () => {
  const r = pozostalyCzas(new Date(TERAZ + 2 * MS_DZIEN), TERAZ);
  assert.equal(r.ton, 'ostrzezenie');
  assert.equal(r.dni, 2);
});

test('pozostalyCzas: ostatnia doba = danger, liczy godziny', () => {
  const r = pozostalyCzas(new Date(TERAZ + 6 * MS_GODZINA), TERAZ);
  assert.equal(r.ton, 'danger');
  assert.equal(r.dni, 0);
  assert.equal(r.godziny, 6);
  assert.match(r.etykieta, /6 godzin/);
});

test('pozostalyCzas: po terminie = danger „PO TERMINIE"', () => {
  const r = pozostalyCzas(new Date(TERAZ - MS_GODZINA), TERAZ);
  assert.equal(r.poTerminie, true);
  assert.equal(r.ton, 'danger');
  assert.equal(r.etykieta, 'PO TERMINIE');
});

test('pozostalyCzas: sama data (bez godziny) = koniec dnia; zła data → nieznany', () => {
  // 2026-01-20 koniec dnia jest > 2026-01-15 10:00 → dodatnie
  const r = pozostalyCzas('2026-01-20', TERAZ);
  assert.equal(r.znany, true);
  assert.equal(r.poTerminie, false);
  const zly = pozostalyCzas('2026-02-30', TERAZ);
  assert.equal(zly.znany, false);
  assert.equal(zly.etykieta, 'Podaj termin z wezwania');
});

test('statusChecklisty: liczy gotowe/wszystkie, komplet i braki', () => {
  const s = statusChecklisty([
    { nazwa: 'KRK', gotowy: true },
    { nazwa: 'ZUS', gotowy: false },
    { nazwa: 'Wykaz robót', gotowy: false },
  ]);
  assert.equal(s.gotowe, 1);
  assert.equal(s.wszystkie, 3);
  assert.equal(s.komplet, false);
  assert.deepEqual(s.brakujace, ['ZUS', 'Wykaz robót']);
});

test('statusChecklisty: pusta lista nie jest kompletem', () => {
  assert.equal(statusChecklisty([]).komplet, false);
  assert.equal(statusChecklisty(null).wszystkie, 0);
});

test('statusChecklisty: wszystko gotowe = komplet', () => {
  const s = statusChecklisty([{ nazwa: 'KRK', gotowy: true }, { nazwa: 'ZUS', gotowy: true }]);
  assert.equal(s.komplet, true);
  assert.deepEqual(s.brakujace, []);
});

test('podpowiedzDoDokumentu: rozpoznaje typowe dokumenty', () => {
  assert.match(podpowiedzDoDokumentu('Zaświadczenie KRK'), /6 miesięcy/);
  assert.match(podpowiedzDoDokumentu('zaświadczenie ZUS o niezaleganiu'), /3 miesiące/);
  assert.match(podpowiedzDoDokumentu('pełnomocnictwo'), /podpis/i);
  assert.equal(podpowiedzDoDokumentu('coś nietypowego'), '');
});
