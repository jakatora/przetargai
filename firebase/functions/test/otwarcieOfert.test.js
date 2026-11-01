import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsujOtwarcie, opisOtwarcia } from '../src/lib/otwarcieOfert.js';

/*
 * Informacja z otwarcia ofert (2026-11-01). Fixture = tekst prawdziwych PDF-ów z e-Zamówień (postępowania
 * BZP z terminem 26–29.10.2026); oczekiwane wartości sprawdzone ręcznie z treścią plików.
 */
const F = JSON.parse(readFileSync(new URL('./fixtures/otwarcie-ofert.json', import.meta.url), 'utf8'));
const p = (k) => parsujOtwarcie(F[k]);
const krotko = (r) => [r.kwota, r.oferty, r.cena_min, r.cena_max, r.czesci];

test('zdania „cena oferty …”, waluta raz jest, raz nie; oferta bez ceny („Cena ---”) się nie liczy', () => {
  assert.deepEqual(krotko(p('c269d4e2_9.pdf')), [195457.23, 6, 158694.93, 552963.59, false]);
  assert.deepEqual(krotko(p('f12be3c9_4.pdf')), [148648, 1, 330497.31, 330497.31, false]);
  assert.deepEqual(krotko(p('325d2c68_3.pdf')), [60000, 1, 55536.37, 55536.37, false], 'kwota podana PO ofertach');
});

test('tabele: cena bez waluty obok NIP-u, „215 275, 00 zł”, oferta 150× kwoty liczona, ale nie w rozpiętości', () => {
  assert.deepEqual(krotko(p('9c55193_16.pdf')), [null, 2, 347721, 451656, false]);
  // 8 ofert z ceną (sprawdzone ręcznie 1.11): „190 750 ,00 zł” ze spacją przed przecinkiem też się liczy.
  assert.deepEqual(krotko(p('ce56e6f_14.pdf')), [200000, 8, 141603.75, 430500, false]);
  assert.deepEqual(p('ce56e6f_14.pdf').ceny_nip.slice(0, 3), [
    { nip: '7842306252', cena: 190750 }, { nip: '6270027029', cena: 215275 }, { nip: '5252811568', cena: 268140 }]);
  assert.deepEqual(krotko(p('0d2407ba_4.pdf')), [362000, 2, 594336, 594336, false]);
});

test('części: kwoty części bez średnich cen jednostkowych, bez rozpiętości; „527.143.56 złotych”', () => {
  const c = p('a38cc5c9_7.pdf');
  assert.deepEqual([c.kwota, c.kwoty_czesci, c.oferty, c.czesci], [550000, [380000, 170000], null, true]);
  assert.equal(p('cfbd3c8e_4.pdf').kwota, 527143.56);
  assert.equal(parsujOtwarcie(['Pismo bez kwot']), null);
  assert.equal(parsujOtwarcie([]), null);
});

test('opis do alertu: odmiana, zakres, kwota zamawiającego (twarda spacja w tysiącach)', () => {
  const opis = (o) => opisOtwarcia(o)?.pl.replace(/ /g, ' ') ?? null;
  assert.equal(opis({ kwota: 195457.23, oferty: 6, cena_min: 158694.93, cena_max: 552963.59 }), '6 ofert z ceną: od 158 695 zł do 552 964 zł; zamawiający przeznaczył 195 457 zł.');
  assert.equal(opis({ kwota: null, oferty: 2, cena_min: 347721, cena_max: 451656 }), '2 oferty z ceną: od 347 721 zł do 451 656 zł.');
  assert.equal(opis({ kwota: 60000, oferty: 1, cena_min: 55536.37, cena_max: 55536.37 }), '1 oferta z ceną: 55 536 zł; zamawiający przeznaczył 60 000 zł.');
  assert.equal(opis({ kwota: 527143.56, oferty: null, cena_min: null, cena_max: null }), 'zamawiający przeznaczył 527 144 zł.');
  assert.equal(opisOtwarcia(null), null);
});

test('pozycjaKonta: miejsce po cenie wśród wszystkich ofert; bez pary albo zły NIP — null', async () => {
  const { pozycjaKonta } = await import('../src/lib/otwarcieOfert.js');
  const o = { oferty: 4, ceny: [141603.75, 185400, 215275, 290587.5], ceny_nip: [{ nip: '6270027029', cena: 215275 }] };
  assert.deepEqual(pozycjaKonta(o, 'PL 627 002 70 29'), { cena: 215275, miejsce: 3, z: 4 });
  assert.equal(pozycjaKonta(o, '5261040828'), null);
  assert.equal(pozycjaKonta(o, '123'), null);
  assert.equal(pozycjaKonta({ ...o, ceny: null }, '6270027029'), null);
});
