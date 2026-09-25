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

// Poprawka 2026-09-25: sama data upływa o 24:00 czasu POLSKIEGO, nie o 23:59:59 UTC
// (to było 01:59/00:59 następnego dnia w Polsce — pokazywało czas, którego już nie ma).
test('pozostalyCzas: sama data — 00:30 PL dnia następnego to już PO TERMINIE', () => {
  // 00:30 CEST 11.06 = 22:30 UTC 10.06
  const r = pozostalyCzas('2026-06-10', Date.UTC(2026, 5, 10, 22, 30));
  assert.equal(r.poTerminie, true);
  assert.equal(r.etykieta, 'PO TERMINIE');
});

test('pozostalyCzas: sama data — o 23:00 PL zostaje 1 godzina (nie 2)', () => {
  const r = pozostalyCzas('2026-06-10', Date.UTC(2026, 5, 10, 21, 0));
  assert.equal(r.poTerminie, false);
  assert.equal(r.dni, 0);
  assert.equal(r.godziny, 1);
  assert.equal(r.ms, MS_GODZINA);
});

// Poprawka 2026-09-25: bez `new Date(str)` — „10.06.2026" dawało 6 października.
test('pozostalyCzas: polski zapis daty = ten sam dzień, koniec dnia PL', () => {
  const teraz = Date.UTC(2026, 5, 10, 21, 0); // 23:00 PL 10.06
  const r = pozostalyCzas('10.06.2026', teraz);
  assert.equal(r.znany, true);
  assert.equal(r.ms, MS_GODZINA);
});

test('pozostalyCzas: godzina bez strefy = czas polski (nie strefa telefonu)', () => {
  // 15:00 CEST = 13:00 UTC; teraz 10:00 UTC → 3 godziny
  const teraz = Date.UTC(2026, 5, 10, 10, 0);
  assert.equal(pozostalyCzas('2026-06-10T15:00', teraz).ms, 3 * MS_GODZINA);
  assert.equal(pozostalyCzas('10.06.2026 15:00', teraz).ms, 3 * MS_GODZINA);
  assert.equal(pozostalyCzas('2026-06-10T15:00:00Z', teraz).ms, 5 * MS_GODZINA);
});

test('pozostalyCzas: zapisy nie do odczytania → nieznany (nie zgadujemy)', () => {
  for (const zly of ['2026-6-10', 'June 10, 2026', '06/10/2026', '2026-06-10T25:00']) {
    const r = pozostalyCzas(zly, TERAZ);
    assert.equal(r.znany, false, zly);
    assert.equal(r.etykieta, 'Podaj termin z wezwania');
  }
});

test('pozostalyCzas: sama data — dokładnie 24:00 PL to już po terminie', () => {
  // zima (CET): 24:00 PL 15.01 = 23:00 UTC 15.01
  const r = pozostalyCzas('2026-01-15', Date.UTC(2026, 0, 15, 23, 0));
  assert.equal(r.poTerminie, true);
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
