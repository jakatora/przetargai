import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEKCJE_JEDZ, generujSciageJedz } from '../src/lib/sciagaJedz.js';

/*
 * „Ściąga do JEDZ" — powyżej progów UE oświadczenie wstępne składa się na formularzu
 * ESPD/JEDZ (eESPD lub formularz zamawiającego). Ściąga mówi sekcja po sekcji, co
 * wpisać i co zaznaczyć, z danymi firmy już wstawionymi. Czysta logika.
 */

const WYKONAWCA = { nazwa: 'Budrem Sp. z o.o.', adres: 'ul. Długa 12, 30-001 Kraków', nip: '5261040827', regon: '012345678', rejestr: 'KRS 0000123456', reprezentant: 'Jan Kowalski', stanowisko: 'Prezes Zarządu', email: 'biuro@budrem.pl', telefon: '600 100 200', wielkosc: 'male' };
const PRZETARG = { tytul: 'Remont dachu szkoły', zamawiajacy: 'Gmina Miejska Kraków', numer: '2026/S 123-456789', zrodlo: 'ted' };

test('sekcje JEDZ: stałe id w kolejności formularza (II A–D, III A–D, IV α, VI)', () => {
  assert.deepEqual(SEKCJE_JEDZ.map((s) => s.id), ['II_A', 'II_B', 'II_C', 'II_D', 'III_A', 'III_B', 'III_C', 'III_D', 'IV_ALFA', 'VI']);
  assert.ok(Object.isFrozen(SEKCJE_JEDZ));
});

test('ściąga: dane firmy wstawione w II A/B, MŚP = TAK dla małej firmy, podstawy wykluczenia = NIE, α zaznaczone, sytuacja steruje II C/D', () => {
  const s = generujSciageJedz({ wykonawca: WYKONAWCA, przetarg: PRZETARG, sytuacja: { polegaNaZasobach: false, podwykonawcy: '', konsorcjum: false } });
  assert.equal(s.nazwa, 'Ściąga do JEDZ (ESPD)');
  assert.match(s.tresc, /CZĘŚĆ II A/);
  assert.match(s.tresc, /Budrem Sp\. z o\.o\./);
  assert.match(s.tresc, /NIP.*5261040827/);
  assert.match(s.tresc, /Czy wykonawca jest MŚP.*TAK/);
  assert.match(s.tresc, /CZĘŚĆ II B[\s\S]*Jan Kowalski[\s\S]*Prezes Zarządu/);
  assert.match(s.tresc, /CZĘŚĆ II C[\s\S]*zaznacz: NIE/);
  assert.match(s.tresc, /CZĘŚĆ II D[\s\S]*zaznacz: NIE/);
  assert.match(s.tresc, /CZĘŚĆ III A[\s\S]*zaznacz: NIE/);
  assert.match(s.tresc, /CZĘŚĆ IV[\s\S]*α[\s\S]*zaznacz: TAK/);
  assert.match(s.tresc, /2026\/S 123-456789/);
  assert.match(s.tresc, /espd\.uzp\.gov\.pl|eESPD/i);
  assert.ok(s.ostrzezenia.length === 0);
});

test('ściąga: duża firma = MŚP NIE; poleganie na zasobach i podwykonawcy = TAK z instrukcją; konsorcjum = osobny JEDZ dla każdego', () => {
  const s = generujSciageJedz({ wykonawca: { ...WYKONAWCA, wielkosc: 'duze' }, przetarg: PRZETARG, sytuacja: { polegaNaZasobach: true, podwykonawcy: 'instalacje elektryczne', konsorcjum: true } });
  assert.match(s.tresc, /Czy wykonawca jest MŚP.*NIE/);
  assert.match(s.tresc, /CZĘŚĆ II C[\s\S]*zaznacz: TAK/);
  assert.match(s.tresc, /osobny JEDZ/i);
  assert.match(s.tresc, /CZĘŚĆ II D[\s\S]*zaznacz: TAK[\s\S]*instalacje elektryczne/);
  assert.match(s.tresc, /każdy członek składa własny JEDZ/i);
  assert.ok(s.ostrzezenia.some((o) => /podmiot/i.test(o)));
});

test('ściąga: brak danych → kropki i ostrzeżenie o uzupełnieniu danych firmy; nic nie rzuca', () => {
  const s = generujSciageJedz({});
  assert.match(s.tresc, /…/);
  assert.doesNotMatch(s.tresc, /undefined|null|NaN/);
  assert.ok(s.ostrzezenia.some((o) => /dane firmy/i.test(o)));
});
