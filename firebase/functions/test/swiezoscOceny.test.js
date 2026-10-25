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
