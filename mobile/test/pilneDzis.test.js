import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pilneDzis } from '../src/lib/pilneDzis.js';

const TERAZ = '2026-11-12T08:00:00.000Z';
const w = (id, deadline, status) => ({ id, status, tender: { id, title: `Przetarg ${id}`, deadline } });

test('terminy w ciągu 3 dni tylko dla ofert w grze, najbliższy pierwszy, najwyżej 3; potem alerty', () => {
  const p = pilneDzis({
    zapisane: [
      w('pojutrze', '2026-11-14T09:00:00.000Z', 'przygotowuje'), w('dzis', '2026-11-12T13:30:00.000Z'),
      w('zlozona', '2026-11-13T09:00:00.000Z', 'zlozona'), w('daleko', '2026-11-20T09:00:00.000Z'),
      w('minal', '2026-11-11T09:00:00.000Z'), w('bez', null), w('jutro', '2026-11-13T12:00:00.000Z'),
      w('czwarty', '2026-11-15T07:00:00.000Z'),
    ],
    nieprzeczytane: 3, teraz: TERAZ,
  });
  assert.deepEqual(p.map((x) => [x.klucz, x.opis.pl]), [
    ['termin-dzis', 'termin dziś, za 5 godz.'], ['termin-jutro', 'termin jutro'], ['termin-pojutrze', 'termin za 2 dni'],
    ['alerty', 'zmiany w zapisanych przetargach'],
  ]);
  assert.equal(p[3].tytul.pl, '3 nowe alerty');
  assert.equal(p[0].wpis.tender.id, 'dzis');
});

test('nic pilnego → pusta lista; odmiana alertów; termin za chwilę', () => {
  assert.deepEqual(pilneDzis({ zapisane: [w('a', '2026-12-01T09:00:00.000Z')], nieprzeczytane: 0, teraz: TERAZ }), []);
  assert.deepEqual(pilneDzis(), []);
  assert.equal(pilneDzis({ nieprzeczytane: 1, teraz: TERAZ })[0].tytul.pl, '1 nowy alert');
  assert.equal(pilneDzis({ nieprzeczytane: 12, teraz: TERAZ })[0].tytul.pl, '12 nowych alertów');
  assert.equal(pilneDzis({ zapisane: [w('z', '2026-11-12T08:40:00.000Z')], teraz: TERAZ })[0].opis.pl, 'termin za mniej niż godzinę');
});

test('QA 13.11: termin samą datą mija z końcem dnia w Polsce; zapis nie-ISO i puste wpisy nie wywracają', async () => {
  const { podsumowanieZapisanych, kolejnoscZapisanych } = await import('../src/lib/kolejnoscZapisanych.js');
  const T = '2026-11-13T18:00:00.000Z'; // 19:00 w Polsce
  const jutro = pilneDzis({ zapisane: [w('j', '2026-11-14')], teraz: T });
  assert.equal(jutro[0].opis.pl, 'termin jutro', 'koniec 14.11, a nie północ UTC');
  assert.equal(podsumowanieZapisanych([w('d', '2026-11-13')], T).pl, '1 przetarg w grze · najbliższy termin dziś');
  assert.deepEqual(kolejnoscZapisanych([w('minal', '2026-11-12'), w('dzis', '2026-11-13')], T).map((x) => x.id), ['dzis', 'minal']);
  assert.deepEqual(pilneDzis({ zapisane: [w('pl', '14.11.2026 10:00'), null, { id: 'x' }], teraz: T }).map((x) => x.klucz), ['termin-pl']);
});

test('QA 13.11: puste wpisy i śmieci w danych nie wywracają pulpitu, paska decyzji ani skrótu karty', async () => {
  const { zbudujPulpit } = await import('../src/lib/pulpit.js');
  const { postepDnia } = await import('../src/lib/postepDnia.js');
  const { skrotKartyFirmy } = await import('../src/lib/skrotKarty.js');
  assert.equal(zbudujPulpit([null, w('a', '2026-12-01')]).lacznie, 1);
  assert.equal(postepDnia({ wybrane: [null, { id: 'a' }], raportWybrane: 1, czyWziety: (m) => m.id === 'z' }).zostalo, 1);
  assert.deepEqual(skrotKartyFirmy({ wykluczenia: [null, '', { a: 1 }, 'drogi'], formalne: 'zle', regiony: 'x' }).map((x) => x.wartosc), [null, 'drogi', null, null, null]);
});

test('QA 13.11 (przegląd): dni kalendarzowe — wieczorem termin jutro rano to „jutro”, 47 h to 2 dni; EN liczba pojedyncza; 999,6 tys. → 1 mln', async () => {
  const { podsumowanieZapisanych, dniDoTerminu } = await import('../src/lib/kolejnoscZapisanych.js');
  const { opisGotowego } = await import('../src/lib/postepDnia.js');
  const { skrotKartyFirmy } = await import('../src/lib/skrotKarty.js');
  const T = '2026-11-13T19:00:00.000Z';
  assert.equal(podsumowanieZapisanych([w('a', '2026-11-14T09:00:00.000Z')], T).termin.pl, 'najbliższy termin jutro');
  assert.equal(pilneDzis({ zapisane: [w('a', '2026-11-14T09:00:00.000Z')], teraz: T })[0].opis.pl, 'termin jutro');
  assert.equal(pilneDzis({ zapisane: [w('b', '2026-11-15T18:00:00.000Z')], teraz: T })[0].opis.pl, 'termin za 2 dni');
  assert.equal(dniDoTerminu('2026-11-12T09:00:00.000Z', Date.parse(T)), null, 'po terminie');
  assert.equal(opisGotowego({ razem: 1, wziete: 1 }).en, "Today's tender has a decision. You are bidding on 1 — saved with deadline reminders.");
  assert.equal(skrotKartyFirmy({ wartosc_max: 999600 })[3].wartosc, 'do 1 mln zł');
});
