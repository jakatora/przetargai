import { test } from 'node:test';
import assert from 'node:assert/strict';

import { duzeKontrakty, kontraktyDlaKonta } from '../src/lib/podwykonawstwo.js';
import { budujDigest } from '../src/lib/digestTresc.js';

/*
 * Podwykonawstwo (2026-11-01): największe kontrakty z tygodnia w działach CPV i województwach karty —
 * kto wygrał, zamawiający, kwota; bez własnych wygranych konta i bez unieważnień.
 */
const wynik = (nadpisz = {}) => ({
  tytul: 'Przebudowa DW 886', zamawiajacy: 'PZDW Rzeszów', cpv: ['45233140-2'], wojewodztwo: '18', opublikowano: '2026-10-30',
  czesci: [{ uniewaznione: false, spojne: true, cenaWybrana: 4_200_000, wartoscUmowy: 4_200_000, zwyciezca: { nazwa: 'RR-BUD Sp. z o.o.', nip: '6871977540', miasto: 'Zarszyn' } }],
  ...nadpisz,
});

test('kontrakty: kwota z umowy (albo ceny), próg 1 mln, bez unieważnień i bez sprzecznych kwot; części jednego zwycięzcy się sumują', () => {
  const lista = duzeKontrakty([
    wynik(),
    wynik({ tytul: 'Mały remont', czesci: [{ spojne: true, cenaWybrana: 300_000, zwyciezca: { nazwa: 'X', nip: '5261040828' } }] }),
    wynik({ tytul: 'Unieważniony', czesci: [{ uniewaznione: true, cenaWybrana: 9_000_000, zwyciezca: null }] }),
    wynik({ tytul: 'Sprzeczne', czesci: [{ spojne: false, cenaWybrana: 9_000_000, zwyciezca: { nazwa: 'Y' } }] }),
    wynik({ tytul: 'Dwie części', czesci: [
      { spojne: true, cenaWybrana: 600_000, zwyciezca: { nazwa: 'Z Sp. j.', nip: '7942840001' } },
      { spojne: true, cenaWybrana: 700_000, zwyciezca: { nazwa: 'Z Sp. j.', nip: '7942840001' } }] }),
  ]);
  assert.deepEqual(lista.map((k) => [k.tytul, k.wykonawca.nazwa, k.kwota, k.dzial, k.woj]), [
    ['Przebudowa DW 886', 'RR-BUD Sp. z o.o.', 4_200_000, '45', '18'], ['Dwie części', 'Z Sp. j.', 1_300_000, '45', '18']]);
});

test('dla konta: dział i województwo z karty, bez własnego NIP-u, największe pierwsze; bez regionów — nic', () => {
  const lista = duzeKontrakty([wynik(), wynik({ tytul: 'Inny region', wojewodztwo: '12' }), wynik({ tytul: 'Inna branża', cpv: ['90910000-9'] })]);
  assert.deepEqual(kontraktyDlaKonta(lista, { dzialy: ['45'], regiony: ['18'] }).map((k) => k.tytul), ['Przebudowa DW 886']);
  assert.deepEqual(kontraktyDlaKonta(lista, { dzialy: ['45'], regiony: ['18'], wlasnyNip: '687-197-75-40' }), []);
  assert.deepEqual(kontraktyDlaKonta(lista, { dzialy: ['45'], regiony: [] }), []);
});

test('przegląd tygodniowy: sekcja podwykonawstwa z wykonawcą i miastem; bez kontraktów — bez sekcji', () => {
  const [k] = duzeKontrakty([wynik()]);
  const d = budujDigest({ liczba: 3, podwykonawstwo: [k] });
  assert.match(d.text, /Duże kontrakty w Twojej branży i regionie — wykonawca może szukać podwykonawców:\n• RR-BUD Sp\. z o\.o\. \(Zarszyn\) — Przebudowa DW 886 · PZDW Rzeszów · 4,20 mln zł/);
  assert.match(d.html, /<li><b>RR-BUD Sp\. z o\.o\. \(Zarszyn\)<\/b>/);
  assert.ok(!budujDigest({ liczba: 1 }).text.includes('podwykonawców'));
});

test('kontraktyTygodnia: czyta strony do końca i zwraca kontrakty', async () => {
  const { kontraktyTygodnia } = await import('../src/jobs/weeklyDigest.js');
  const strony = [{ pozycje: [wynik()], kursor: { id: 'a' }, koniec: false }, { pozycje: [wynik({ tytul: 'Druga strona' })], kursor: null, koniec: true }];
  let i = 0;
  const lista = await kontraktyTygodnia('2026-10-25', { repo: { strona: async () => strony[i++] } });
  assert.deepEqual(lista.map((k) => k.tytul), ['Przebudowa DW 886', 'Druga strona']);
});

test('dostawy (działy poniżej 45) odpadają — podwykonawców szuka się przy robotach i usługach', () => {
  assert.deepEqual(duzeKontrakty([wynik({ cpv: ['09310000-5'] }), wynik({ cpv: ['90910000-9'] })]).map((k) => k.dzial), ['90']);
});

test('profil z dopasowań: działy i regiony od 20% udziału; konto bez karty dostaje kontrakty z regionu, w którym pracuje', async () => {
  const { profilZDopasowan } = await import('../src/lib/podwykonawstwo.js');
  const { podwykonawstwoDlaKonta } = await import('../src/jobs/weeklyDigest.js');
  const dop = [
    ...Array.from({ length: 6 }, () => ({ cpv: '45233140-2', wojewodztwo: '18' })),
    ...Array.from({ length: 3 }, () => ({ cpv: '45453000-7', wojewodztwo: '12' })),
    { cpv: '90910000-9', wojewodztwo: '02' },
  ];
  assert.deepEqual(profilZDopasowan(dop), { dzialy: ['45'], regiony: ['18', '12'] });
  const kontrakty = duzeKontrakty([wynik(), wynik({ tytul: 'Dolny Śląsk', wojewodztwo: '02' })]);
  const lista = await podwykonawstwoDlaKonta({ id: 'u1', cpv_codes: [], regiony: [] }, kontrakty, Date.now(), { dopasowania: { profilDopasowan: async () => dop } });
  assert.deepEqual(lista.map((k) => k.tytul), ['Przebudowa DW 886']);
});

test('profil przeglądu: karta wygrywa; bez karty — działy i regiony z dopasowań jako kody i województwa', async () => {
  const { profilPrzegladu } = await import('../src/jobs/weeklyDigest.js');
  const dop = Array.from({ length: 10 }, () => ({ cpv: '45233140-2', wojewodztwo: 'PL18' }));
  const dopasowania = { profilDopasowan: async () => dop };
  const zKarta = { id: 'u1', cpv_codes: ['90910000-9'], regiony: ['12'] };
  assert.equal(await profilPrzegladu(zKarta, Date.now(), { dopasowania }), zKarta);
  const p = await profilPrzegladu({ id: 'u2', cpv_codes: [], regiony: [] }, Date.now(), { dopasowania });
  assert.deepEqual([p.cpv_codes, p.regiony], [['45000000'], ['18']]);
  const czesciowo = await profilPrzegladu({ id: 'u3', cpv_codes: ['90910000-9'], regiony: [] }, Date.now(), { dopasowania });
  assert.deepEqual([czesciowo.cpv_codes, czesciowo.regiony], [['90910000-9'], ['18']]);
});
