import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stanZalacznikowZSejfu } from '../src/lib/stanDokumentowWezwania.js';

const SEJF = [
  { id: 1, nazwa: 'Zaświadczenie o niezaleganiu w składkach (ZUS)', status: 'gotowy' },
  { id: 2, nazwa: 'Zaświadczenie o niezaleganiu w podatkach (US)', status: 'przeterminowany' },
  { id: 3, nazwa: 'Zaświadczenie o niezaleganiu w podatkach (US)', status: 'zamow_nowy' },
  { id: 4, nazwa: 'Polisa OC', status: null },
];

test('załączniki z wezwania dostają stan z Sejfu: gotowy, najlepszy z kilku, brak daty, brak w Sejfie', () => {
  const s = stanZalacznikowZSejfu(SEJF, [
    'Zaświadczenie o niezaleganiu z ZUS',
    'Zaświadczenie o niezaleganiu z US',
    'Polisa OC z dowodem opłacenia',
    'Informacja z Krajowego Rejestru Karnego',
    'Mój własny dokument',
  ]);
  assert.equal(s['Zaświadczenie o niezaleganiu z ZUS'].ton, 'sukces');
  assert.match(s['Zaświadczenie o niezaleganiu z ZUS'].etykieta, /Gotowy/);
  assert.equal(s['Zaświadczenie o niezaleganiu z US'].status, 'zamow_nowy', 'z dwóch egzemplarzy bierzemy lepszy');
  assert.equal(s['Polisa OC z dowodem opłacenia'].status, 'nieznany');
  assert.match(s['Polisa OC z dowodem opłacenia'].etykieta, /Uzupełnij datę/);
  assert.equal(s['Informacja z Krajowego Rejestru Karnego'].wSejfie, false);
  assert.equal(s['Mój własny dokument'], undefined, 'nieznana kategoria — bez wpisu');
});

test('pusty sejf albo śmieci → brak w Sejfie / pusty wynik, nie rzuca', () => {
  assert.equal(stanZalacznikowZSejfu([], ['Zaświadczenie o niezaleganiu z ZUS'])['Zaświadczenie o niezaleganiu z ZUS'].wSejfie, false);
  assert.deepEqual(stanZalacznikowZSejfu(null, null), {});
});
