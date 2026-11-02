import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocenaAktualna } from '../src/lib/swiezoscOceny.js';

const H = 'karta-v1';
const termin = (dni) => new Date(Date.UTC(2026, 10, 1 + dni)).toISOString();

test('ślad z tej samej wersji karty jest aktualny; inna wersja albo brak śladu — nie', () => {
  assert.equal(ocenaAktualna({ decyzja: 'odrzucony', przyczyna: 'branza', criteria_hash: H }, { criteriaHash: H }), true);
  assert.equal(ocenaAktualna({ decyzja: 'wybrany', criteria_hash: H }, { criteriaHash: H }), true);
  assert.equal(ocenaAktualna({ decyzja: 'odrzucony', przyczyna: 'branza', criteria_hash: 'inna' }, { criteriaHash: H }), false);
  assert.equal(ocenaAktualna(null, { criteriaHash: H }), false);
  assert.equal(ocenaAktualna({ decyzja: 'odrzucony', criteria_hash: null }, { criteriaHash: undefined }), true, 'bez wymogu wersji liczy się sam ślad');
});

test('odrzucenie „termin” traci ważność, gdy zamawiający PRZEDŁUŻYŁ termin; nie traci, gdy termin ten sam lub wcześniejszy', () => {
  const slad = { decyzja: 'odrzucony', przyczyna: 'termin', criteria_hash: H, termin: termin(3) };
  assert.equal(ocenaAktualna(slad, { tender: { deadline: termin(14) }, criteriaHash: H }), false, 'przedłużony → ocenić ponownie');
  assert.equal(ocenaAktualna(slad, { tender: { deadline: termin(3) }, criteriaHash: H }), true);
  assert.equal(ocenaAktualna(slad, { tender: { deadline: termin(1) }, criteriaHash: H }), true, 'skrócony nie otwiera na nowo');
  assert.equal(ocenaAktualna(slad, { tender: { deadline: null }, criteriaHash: H }), true, 'brak terminu w ogłoszeniu = brak dowodu przedłużenia');
  assert.equal(ocenaAktualna({ ...slad, termin: null }, { tender: { deadline: termin(14) }, criteriaHash: H }), true, 'stary ślad bez zapisanego terminu zostaje');
});

test('inne przyczyny nie zależą od terminu — przedłużenie ich nie otwiera', () => {
  for (const przyczyna of ['branza', 'teren', 'za_duze', 'za_male', 'wykluczenie', 'warunki', 'inne']) {
    const slad = { decyzja: 'odrzucony', przyczyna, criteria_hash: H, termin: termin(3) };
    assert.equal(ocenaAktualna(slad, { tender: { deadline: termin(30) }, criteriaHash: H }), true, przyczyna);
  }
});

test('odrzucenie „termin” traci ważność, gdy przy OBECNYM progu przetarg zdąży (złagodzona reguła zapytań, 2026-11-02)', () => {
  const ocena = { criteria_hash: 'v1', decyzja: 'odrzucony', przyczyna: 'termin', termin: '2026-11-06T10:00:00.000Z' };
  const tender = { id: 'pz:1', source: 'platformazakupowa', deadline: '2026-11-06T10:00:00.000Z' };
  const teraz = '2026-11-02T10:00:00.000Z'; // 4 dni do terminu
  assert.equal(ocenaAktualna(ocena, { tender, criteriaHash: 'v1', potrzebaDni: () => 3, teraz }), false, 'zdąży przy 3 dniach — wraca do lejka');
  assert.equal(ocenaAktualna(ocena, { tender, criteriaHash: 'v1', potrzebaDni: () => 5, teraz }), true, 'przy 5 dniach dalej odrzucony');
  assert.equal(ocenaAktualna(ocena, { tender, criteriaHash: 'v1' }), true, 'bez progu — stara reguła');
  assert.equal(ocenaAktualna({ ...ocena, przyczyna: 'branza' }, { tender, criteriaHash: 'v1', potrzebaDni: () => 3, teraz }), true, 'inne przyczyny bez zmian');
});

test('odrzucenie „termin” przy OBECNYM progu jest ostateczne — bez pętli płatnej oceny AI co przebieg', () => {
  const tender = { id: 'bk:1', source: 'baza_konkurencyjnosci', deadline: '2026-11-06T10:00:00.000Z' };
  const teraz = '2026-11-02T10:00:00.000Z'; // 4 dni do terminu
  const ai = { criteria_hash: 'v1', decyzja: 'odrzucony', przyczyna: 'termin', etap: 'ai', termin: tender.deadline, prog_dni: 3 };
  assert.equal(ocenaAktualna(ai, { tender, criteriaHash: 'v1', potrzebaDni: () => 3, teraz }), true, 'AI odrzuciło przy progu 3 — zostaje');
  assert.equal(ocenaAktualna({ ...ai, prog_dni: 5 }, { tender, criteriaHash: 'v1', potrzebaDni: () => 3, teraz }), false, 'próg spadł z 5 do 3 — raz wraca');
  assert.equal(ocenaAktualna({ ...ai, prog_dni: 7 }, { tender, criteriaHash: 'v1', potrzebaDni: () => 7, teraz }), true, 'własny próg klienta bez zmian');
});
